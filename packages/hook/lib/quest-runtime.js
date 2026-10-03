const fs = require('node:fs')
const path = require('node:path')
const net = require('node:net')
const crypto = require('node:crypto')
const { startTicks } = require('./helm-runtime-contract')
const { sanitizeQuestDiagnostic } = require('./quest-diagnostics')

const DIRECTORY = '/tmp/slipway-quest-runtimes'
const MAX_REQUEST_BYTES = 32 * 1024
const MAX_RESULT_BYTES = 128 * 1024
const MAX_RUNS = 32
const terminal = new Set(['completed', 'failed', 'skipped'])
const milliseconds = (value) =>
  Number.isFinite(value)
    ? value
    : Number.isFinite(Date.parse(value))
    ? Date.parse(value)
    : null
const sensitive =
  /password|passwd|secret|token|api.?key|credential|private.?key/i
const fail = (message, code = 'QUEST_UNAVAILABLE') =>
  Object.assign(new Error(message), { code })
const digest = (value) =>
  crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex')

function safeValue(value, depth = 0, seen = new Set()) {
  if (depth > 8)
    throw fail('Value exceeds the nesting limit.', 'QUEST_INPUT_INVALID')
  if (
    value === null ||
    typeof value === 'boolean' ||
    (typeof value === 'number' && Number.isFinite(value))
  )
    return value
  if (typeof value === 'string')
    return sanitizeQuestDiagnostic(value, { preserveWhitespace: true })
  if (!value || typeof value !== 'object' || seen.has(value))
    throw fail('Value is not JSON-compatible.', 'QUEST_INPUT_INVALID')
  seen.add(value)
  let result
  if (Array.isArray(value))
    result = value.map((item) => safeValue(item, depth + 1, seen))
  else {
    if (![Object.prototype, null].includes(Object.getPrototypeOf(value)))
      throw fail('Value must be a plain object.', 'QUEST_INPUT_INVALID')
    result = Object.fromEntries(
      Object.entries(value).map(([key, item]) => [
        key,
        sensitive.test(key) ? '<redacted>' : safeValue(item, depth + 1, seen)
      ])
    )
  }
  seen.delete(value)
  return result
}

function logTail(value, limit = 32768) {
  if (typeof value !== 'string') return null
  const bytes = Buffer.from(sanitizeQuestDiagnostic(value))
  let offset = Math.max(0, bytes.length - limit)
  while (offset < bytes.length && (bytes[offset] & 0xc0) === 0x80) offset++
  return bytes.subarray(offset).toString('utf8')
}

function describeJob(job) {
  const inputs = Object.entries(job.inputs || {}).map(([name, field]) => {
    const secret =
      field.sensitive === true || field.protect === true || sensitive.test(name)
    const output = {
      name,
      type: field.type || 'ref',
      required: field.required === true,
      sensitive: secret
    }
    for (const key of [
      'friendlyName',
      'description',
      'isIn',
      'min',
      'max',
      'minLength',
      'maxLength'
    ]) {
      if (field[key] !== undefined)
        try {
          output[key] = safeValue(field[key])
        } catch {
          /* unsupported metadata stays server-side */
        }
    }
    if (!secret && field.defaultsTo !== undefined)
      try {
        output.defaultsTo = safeValue(field.defaultsTo)
      } catch {
        /* no unsafe defaults */
      }
    output.serverValidated = Boolean(
      field.custom ||
        field.customValidation ||
        field.serverValidated ||
        !['string', 'number', 'boolean', 'json', 'ref'].includes(output.type)
    )
    return output
  })
  const schedule = job.schedule || {}
  const type =
    ['cron', 'interval', 'timeout', 'date'].find(
      (key) => schedule[key] !== undefined
    ) || 'manual'
  const safe = {
    name: job.name,
    script: job.script,
    friendlyName: job.friendlyName || job.name,
    description: job.description || '',
    inputs,
    schedule: type === 'manual' ? null : schedule[type],
    scheduleType: type,
    timezone: schedule.timezone || schedule.cronOptions?.timezone || null,
    nextRunAt: job.nextRunAt ? new Date(job.nextRunAt).getTime() : null,
    paused: Boolean(job.paused),
    isRunning: job.runningCount > 0,
    withoutOverlapping: Boolean(job.withoutOverlapping),
    scheduledInputs: null,
    validationErrors: []
  }
  safe.metadataVersion = digest({
    name: safe.name,
    script: safe.script,
    inputs,
    schedule
  })
  return safe
}

function validateInputs(job, values) {
  if (
    !values ||
    ![Object.prototype, null].includes(Object.getPrototypeOf(values)) ||
    Array.isArray(values)
  )
    throw fail('Job inputs must be an object.', 'QUEST_INPUT_INVALID')
  safeValue(values) // Reject cycles and unsupported values before serialization.
  if (Buffer.byteLength(JSON.stringify(values)) > 16 * 1024)
    throw fail('Job inputs exceed 16 KiB.', 'QUEST_INPUT_INVALID')
  const fields = new Map(job.inputs.map((field) => [field.name, field]))
  for (const [name, value] of Object.entries(values)) {
    const field = fields.get(name)
    if (!field || ['__proto__', 'prototype', 'constructor'].includes(name))
      throw fail(`Unknown input: ${name}.`, 'QUEST_INPUT_INVALID')
    if (value !== null) {
      if (
        ['string', 'number', 'boolean'].includes(field.type) &&
        typeof value !== field.type
      )
        throw fail(`${name} must be ${field.type}.`, 'QUEST_INPUT_INVALID')
      if (
        typeof value === 'number' &&
        (!Number.isFinite(value) ||
          (field.min !== undefined && value < field.min) ||
          (field.max !== undefined && value > field.max))
      )
        throw fail(
          `${name} is outside its allowed range.`,
          'QUEST_INPUT_INVALID'
        )
      if (
        typeof value === 'string' &&
        ((field.minLength !== undefined && value.length < field.minLength) ||
          (field.maxLength !== undefined && value.length > field.maxLength))
      )
        throw fail(`${name} has an invalid length.`, 'QUEST_INPUT_INVALID')
    }
    if (field.isIn && !field.isIn.includes(value))
      throw fail(`${name} is not an allowed value.`, 'QUEST_INPUT_INVALID')
  }
  // Quest's normal machine invocation remains the final validator, including
  // required values supplied by source-owned job defaults and custom rules.
  return values
}

function createQuestRuntime({
  sails,
  appId,
  deploymentId,
  directory = DIRECTORY,
  runtime = process
}) {
  const runs = new Map(),
    requests = new Map(),
    listeners = []
  let activeAdmission = null,
    server,
    filename,
    socketPath,
    identity
  const now = () => Date.now()
  const remember = (run) => {
    runs.set(run.runId, run)
    if (runs.size > MAX_RUNS) {
      const completed = [...runs].find(([, item]) => terminal.has(item.state))
      // Retention is bounded even if many scheduled jobs overlap. Eviction is
      // loss of inspection evidence, never cancellation or a terminal result.
      runs.delete(completed?.[0] || runs.keys().next().value)
    }
  }
  const summary = (run) => {
    const { inputs, result, stdout, stderr, error, ...rest } = run
    return { ...rest, resultStatus: result?.status || 'unavailable' }
  }
  const metadata = () => {
    const jobs = sails.quest.metadata()
    if (!Array.isArray(jobs) || jobs.length > 200)
      throw fail('Quest job metadata is unavailable.')
    return jobs.map(describeJob)
  }
  const getRuntime = () => {
    const info = sails.quest?.getRuntime?.()
    if (
      info?.contractVersion !== 1 ||
      !info.runtimeId ||
      info.capabilities?.residentState !== true ||
      info.capabilities?.runIdentity !== true
    )
      throw fail('Upgrade the app’s Quest hook to use the resident runtime.')
    return info
  }
  function record(kind, data) {
    const info = getRuntime()
    if (
      !data.runId ||
      data.runtimeId !== info.runtimeId ||
      !Number.isSafeInteger(data.sequence)
    )
      return
    const old = runs.get(data.runId)
    if (old && (data.sequence <= old.sequence || terminal.has(old.state)))
      return
    const admission =
      kind === 'running' && activeAdmission?.name === data.name
        ? activeAdmission
        : null
    const result = data.result || { status: 'unavailable' }
    let boundedResult
    try {
      boundedResult = safeValue(result)
      if (Buffer.byteLength(JSON.stringify(boundedResult)) > MAX_RESULT_BYTES)
        boundedResult = { status: 'too_large' }
    } catch {
      boundedResult = { status: 'serialization_error' }
    }
    const run = {
      ...old,
      runId: data.runId,
      jobName: data.name,
      runtimeId: info.runtimeId,
      deploymentId: String(deploymentId),
      sequence: data.sequence,
      state: kind,
      trigger: old?.trigger || (admission ? 'manual' : 'scheduled'),
      actor: old?.actor || admission?.actor || null,
      requestId: old?.requestId || admission?.requestId || null,
      requestedAt:
        old?.requestedAt ||
        admission?.requestedAt ||
        milliseconds(data.startedAt) ||
        milliseconds(data.timestamp) ||
        now(),
      startedAt:
        milliseconds(data.startedAt) ||
        old?.startedAt ||
        milliseconds(data.timestamp) ||
        now(),
      finishedAt:
        kind === 'running'
          ? null
          : milliseconds(data.finishedAt) ||
            milliseconds(data.timestamp) ||
            now(),
      duration: Number.isFinite(data.duration) ? data.duration : null,
      exitCode:
        kind === 'completed'
          ? 0
          : Number.isInteger(data.exitCode)
          ? data.exitCode
          : null,
      result: kind === 'running' ? { status: 'unavailable' } : boundedResult,
      inputs: safeValue(data.inputs || {}),
      stdout:
        typeof data.logs?.stdout === 'string'
          ? logTail(data.logs.stdout)
          : null,
      stderr:
        typeof data.logs?.stderr === 'string'
          ? logTail(data.logs.stderr)
          : null,
      logsTruncated: Boolean(
        data.logs?.stdoutTruncated ||
          data.logs?.stderrTruncated ||
          Buffer.byteLength(data.logs?.stdout || '') > 32768 ||
          Buffer.byteLength(data.logs?.stderr || '') > 32768
      ),
      error: data.error
        ? sanitizeQuestDiagnostic(data.error.message || String(data.error))
        : null
    }
    // Explicit schema annotations also redact non-secret-looking input names.
    const job = metadata().find((item) => item.name === data.name)
    for (const field of job?.inputs || [])
      if (field.sensitive && field.name in run.inputs)
        run.inputs[field.name] = '<redacted>'
    remember(run)
    if (admission) admission.run = run
  }
  async function dispatch(message) {
    const info = getRuntime()
    if (
      String(message.appId) !== String(appId) ||
      String(message.deploymentId) !== String(deploymentId)
    )
      throw fail('The deployment target changed.', 'QUEST_TARGET_CHANGED')
    if (message.runtimeId && message.runtimeId !== info.runtimeId)
      throw fail(
        'The app restarted. Review the job again.',
        'QUEST_TARGET_CHANGED'
      )
    if (message.command === 'snapshot')
      return {
        version: 1,
        runtimeId: info.runtimeId,
        observedAt: now(),
        capabilities: {
          invoke: true,
          typedInputs: info.capabilities.inputMetadata === true,
          results: info.capabilities.businessResults === true,
          pause: typeof sails.quest.pause === 'function',
          resume: typeof sails.quest.resume === 'function',
          cancel: false
        },
        jobs: metadata(),
        runs: [...runs.values()].map(summary)
      }
    if (message.command === 'run') {
      const run = runs.get(message.runId)
      if (!run)
        throw fail(
          'This runtime no longer retains that run.',
          'QUEST_RUN_UNAVAILABLE'
        )
      return { run }
    }
    if (!message.runtimeId)
      throw fail(
        'Refresh the runtime before taking this action.',
        'QUEST_TARGET_CHANGED'
      )
    const job = metadata().find((item) => item.name === message.name)
    if (
      !job ||
      !/^[a-zA-Z0-9][a-zA-Z0-9_/-]*$/.test(message.name) ||
      message.name.includes('..')
    )
      throw fail('Unknown Quest job.', 'QUEST_INPUT_INVALID')
    if (message.command === 'pause' || message.command === 'resume') {
      if (typeof sails.quest[message.command] !== 'function')
        throw fail('This runtime does not support this control.')
      await sails.quest[message.command](message.name)
      const current = metadata().find((item) => item.name === message.name)
      if (!current || current.paused !== (message.command === 'pause'))
        throw fail(
          'The resident scheduler did not confirm this change.',
          'QUEST_UNCONFIRMED'
        )
      return { job: current }
    }
    if (message.command !== 'invoke')
      throw fail('Unsupported Quest command.', 'QUEST_INPUT_INVALID')
    if (message.metadataVersion !== job.metadataVersion)
      throw fail(
        'Job inputs changed. Review the current fields.',
        'QUEST_TARGET_CHANGED'
      )
    if (!/^[a-zA-Z0-9-]{16,80}$/.test(message.requestId || ''))
      throw fail('A valid invocation key is required.', 'QUEST_INPUT_INVALID')
    const values = validateInputs(
      job,
      message.jobInputs === undefined ? {} : message.jobInputs
    )
    const requestHash = digest({
      name: message.name,
      metadataVersion: message.metadataVersion,
      values
    })
    const existing = requests.get(message.requestId)
    if (existing) {
      if (existing.hash !== requestHash)
        throw fail(
          'Invocation key already used for different inputs.',
          'QUEST_INPUT_INVALID'
        )
      return existing.promise
    }
    if (job.paused) throw fail('This job is paused.', 'QUEST_PAUSED')
    if (job.withoutOverlapping && job.isRunning)
      throw fail('This job is already running.', 'QUEST_ALREADY_RUNNING')
    if (
      [...runs.values()].filter((run) => !terminal.has(run.state)).length >=
        MAX_RUNS ||
      requests.size >= 1000
    )
      throw fail('The resident invocation limit has been reached.')
    const admission = {
      name: message.name,
      actor: String(message.actor || '').slice(0, 160),
      requestId: message.requestId,
      requestedAt: now()
    }
    let resolveAdmission, rejectAdmission
    const promise = new Promise((resolve, reject) => {
      resolveAdmission = resolve
      rejectAdmission = reject
    })
    requests.set(message.requestId, { hash: requestHash, promise })
    // Subscription is already installed. The canonical upstream run ID is
    // emitted synchronously before child spawn; never invent a second run ID.
    activeAdmission = admission
    let execution
    try {
      execution = sails.quest.run(message.name, values)
    } catch (error) {
      activeAdmission = null
      rejectAdmission(error)
      return promise
    }
    activeAdmission = null
    if (admission.run) resolveAdmission({ run: summary(admission.run) })
    else {
      rejectAdmission(
        fail(
          'The runtime did not confirm run admission. Do not repeat the job until its state is checked.',
          'QUEST_UNCONFIRMED'
        )
      )
    }
    Promise.resolve(execution).catch(() => {
      /* upstream error events own terminal evidence */
    })
    return promise
  }
  async function start() {
    if (
      runtime.platform !== 'linux' ||
      runtime.env.SLIPWAY_HELM_EXECUTION_ID ||
      !/^\d+$/.test(String(appId)) ||
      !/^\d+$/.test(String(deploymentId))
    )
      return false
    if (
      (runtime.env.SLIPWAY_APP_ID || runtime.env.SLIPWAY_TELEMETRY_APP_ID) !==
        String(appId) ||
      (runtime.env.SLIPWAY_DEPLOYMENT_ID ||
        runtime.env.SLIPWAY_TELEMETRY_DEPLOYMENT_ID) !== String(deploymentId)
    )
      return false
    const info = getRuntime()
    const ticks = startTicks(fs.readFileSync('/proc/self/stat', 'utf8'))
    if (!ticks) return false
    fs.mkdirSync(directory, { recursive: true, mode: 0o700 })
    const dirStat = fs.lstatSync(directory)
    if (
      !dirStat.isDirectory() ||
      dirStat.mode & 0o077 ||
      dirStat.uid !== runtime.getuid()
    )
      throw fail('Quest runtime directory has unsafe ownership or permissions.')
    const stem = `${appId}-${deploymentId}-${runtime.pid}`
    socketPath = path.join(directory, `${stem}.sock`)
    filename = path.join(directory, `${stem}.json`)
    identity = {
      version: 1,
      appId: String(appId),
      deploymentId: String(deploymentId),
      runtimeId: info.runtimeId,
      pid: runtime.pid,
      startTicks: ticks,
      socket: socketPath
    }
    for (const [event, state] of [
      ['start', 'running'],
      ['complete', 'completed'],
      ['error', 'failed']
    ]) {
      const listener = (data) => {
        try {
          record(state, data)
        } catch {
          /* malformed telemetry cannot crash the app */
        }
      }
      sails.prependListener(`quest:job:${event}`, listener)
      listeners.push([`quest:job:${event}`, listener])
    }
    server = net.createServer((socket) => {
      let chunks = [],
        size = 0,
        handled = false
      socket.setTimeout(5000, () => socket.destroy())
      socket.on('error', () => {})
      socket.on('data', async (chunk) => {
        if (handled) return
        size += chunk.length
        if (size > MAX_REQUEST_BYTES) {
          handled = true
          socket.destroy()
          return
        }
        chunks.push(chunk)
        if (!chunk.includes(10)) return
        handled = true
        try {
          const message = JSON.parse(
            Buffer.concat(chunks).toString('utf8').trim()
          )
          const body = JSON.stringify({
            ok: true,
            data: await dispatch(message)
          })
          if (Buffer.byteLength(body) > 512 * 1024)
            throw fail('Resident response exceeds its byte budget.')
          socket.end(body + '\n')
        } catch (error) {
          socket.end(
            JSON.stringify({
              ok: false,
              error: {
                code: error.code || 'QUEST_UNAVAILABLE',
                message: error.message || 'Quest runtime unavailable.'
              }
            }) + '\n'
          )
        }
      })
    })
    await new Promise((resolve, reject) => {
      server.once('error', reject)
      server.listen(socketPath, resolve)
    })
    fs.chmodSync(socketPath, 0o600)
    fs.writeFileSync(filename, JSON.stringify(identity), {
      mode: 0o600,
      flag: 'wx'
    })
    return true
  }
  async function stop() {
    for (const [event, listener] of listeners)
      sails.removeListener(event, listener)
    if (server) await new Promise((resolve) => server.close(resolve))
    for (const file of [filename, socketPath])
      if (file)
        try {
          fs.unlinkSync(file)
        } catch (error) {
          if (error.code !== 'ENOENT') throw error
        }
  }
  return {
    start,
    stop,
    dispatch,
    record,
    describeJob,
    get runs() {
      return runs
    }
  }
}
module.exports = {
  createQuestRuntime,
  describeJob,
  validateInputs,
  safeValue,
  DIRECTORY
}
