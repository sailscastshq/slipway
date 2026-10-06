const fs = require('node:fs')
const path = require('node:path')
const net = require('node:net')
const crypto = require('node:crypto')
const { startTicks } = require('./helm-runtime-contract')
const { sanitizeQuestDiagnostic } = require('./quest-diagnostics')
const { questRedactor, forgetQuestRedactor } = require('./quest-redaction')

const DIRECTORY = '/tmp/slipway-quest-runtimes'
const MAX_REQUEST_BYTES = 32 * 1024
const MAX_RESULT_BYTES = 128 * 1024
const MAX_RUNS = 32
const terminal = new Set(['completed', 'failed', 'skipped', 'cancelled'])
const milliseconds = (value) => {
  const parsed = Number.isFinite(value)
    ? value
    : value instanceof Date
    ? value.getTime()
    : Date.parse(value)
  return Number.isFinite(parsed) ? parsed : null
}
const sensitive =
  /password|passwd|secret|token|api.?key|credential|private.?key/i
const fail = (message, code = 'QUEST_UNAVAILABLE') =>
  Object.assign(new Error(message), { code })
const digest = (value) =>
  crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex')

function safeValue(value, depth = 0, seen = new Set(), redactor) {
  if (depth > 8)
    throw fail('Value exceeds the nesting limit.', 'QUEST_INPUT_INVALID')
  if (
    value === null ||
    typeof value === 'boolean' ||
    (typeof value === 'number' && Number.isFinite(value))
  )
    return redactor ? redactor.value(value) : value
  if (typeof value === 'string' && redactor && redactor.value(value) !== value)
    return '<redacted>'
  if (typeof value === 'string')
    return redactor
      ? redactor.text(value, { preserveWhitespace: true })
      : sanitizeQuestDiagnostic(value, { preserveWhitespace: true })
  if (!value || typeof value !== 'object' || seen.has(value))
    throw fail('Value is not JSON-compatible.', 'QUEST_INPUT_INVALID')
  seen.add(value)
  let result
  if (Array.isArray(value))
    result = value.map((item) => safeValue(item, depth + 1, seen, redactor))
  else {
    if (![Object.prototype, null].includes(Object.getPrototypeOf(value)))
      throw fail('Value must be a plain object.', 'QUEST_INPUT_INVALID')
    result = Object.fromEntries(
      Object.entries(value).map(([key, item]) => [
        redactor ? redactor.text(key, { preserveWhitespace: true }) : key,
        sensitive.test(key)
          ? '<redacted>'
          : safeValue(item, depth + 1, seen, redactor)
      ])
    )
  }
  seen.delete(value)
  return result
}

// Redact business data without renaming the result transport's fixed keys or
// treating its status/validated named exit as an echoed input value.
function safeResult(result, redactor, limitBytes) {
  let output
  try {
    if (!redactor.available)
      output = { status: 'unavailable', reason: 'redaction_unavailable' }
    else if (
      result &&
      [
        'available',
        'undefined',
        'too_large',
        'serialization_error',
        'unavailable',
        'unsupported'
      ].includes(result.status)
    ) {
      output = { status: result.status }
      if (Object.hasOwn(result, 'value'))
        output.value = safeValue(result.value, 0, new Set(), redactor)
      if (typeof result.reason === 'string')
        output.reason = redactor.text(result.reason, {
          preserveWhitespace: true
        })
      if (result.truncated === true) output.truncated = true
      if (Buffer.byteLength(JSON.stringify(output)) > limitBytes)
        output = { status: 'too_large', truncated: true }
    } else output = { status: 'unavailable' }
  } catch {
    output = { status: 'serialization_error' }
  }
  if (
    typeof result?.exit === 'string' &&
    /^[a-zA-Z0-9_.:-]{1,128}$/.test(result.exit)
  )
    output.exit = result.exit
  return output
}

function logTail(value, limit = 32768, redactor, truncated = false) {
  if (typeof value !== 'string') return null
  const bytes = Buffer.from(
    redactor
      ? redactor.text(value, { truncated })
      : sanitizeQuestDiagnostic(value)
  )
  let offset = Math.max(0, bytes.length - limit)
  while (offset < bytes.length && (bytes[offset] & 0xc0) === 0x80) offset++
  return bytes.subarray(offset).toString('utf8')
}

function describeScheduledInputs(metadata, inputs) {
  if (
    !metadata ||
    metadata.validation !== 'not_checked' ||
    !metadata.fields ||
    typeof metadata.fields !== 'object' ||
    Array.isArray(metadata.fields) ||
    !metadata.values ||
    typeof metadata.values !== 'object' ||
    Array.isArray(metadata.values)
  )
    return null
  const sources = new Set([
    'job_input',
    'script_input',
    'schema_default',
    'omitted'
  ])
  const values = {},
    fields = {}
  const limitBytes = 16 * 1024
  let usedBytes = 2
  for (const input of inputs) {
    const field = metadata.fields[input.name]
    if (!field || !sources.has(field.source)) continue
    const secret = input.sensitive || field.sensitive === true
    const output = {
      source: field.source,
      sensitive: secret,
      available: false,
      missingRequired: input.required && field.missingRequired === true
    }
    if (secret) output.reason = 'sensitive'
    else if (
      field.available === true &&
      field.source !== 'omitted' &&
      Object.hasOwn(metadata.values, input.name)
    ) {
      try {
        const value = safeValue(metadata.values[input.name])
        const bytes = Buffer.byteLength(JSON.stringify({ [input.name]: value }))
        if (bytes > limitBytes) output.reason = 'too_large'
        else if (usedBytes + bytes > limitBytes)
          output.reason = 'metadata_limit'
        else {
          Object.defineProperty(values, input.name, { value, enumerable: true })
          output.available = true
          usedBytes += bytes
        }
      } catch {
        output.reason = 'serialization_error'
      }
    } else if (
      ['too_large', 'serialization_error', 'metadata_limit'].includes(
        field.reason
      )
    )
      output.reason = field.reason
    Object.defineProperty(fields, input.name, {
      value: output,
      enumerable: true
    })
  }
  return { values, fields, validation: 'not_checked', limitBytes }
}

function describeScheduleState(state) {
  if (
    !state ||
    ![
      'not_attempted',
      'registered',
      'not_registered',
      'stopped',
      'consumed',
      'failed'
    ].includes(state.registration) ||
    !['not_checked', 'valid', 'invalid'].includes(state.validation)
  )
    return null
  const validationErrors = (
    Array.isArray(state.validationErrors) ? state.validationErrors : []
  )
    .slice(0, 8)
    .filter((error) => error && typeof error.message === 'string')
    .map((error) => ({
      code:
        typeof error.code === 'string' && /^[A-Z0-9_]{1,64}$/i.test(error.code)
          ? error.code
          : 'QUEST_SCHEDULE_INVALID',
      message: sanitizeQuestDiagnostic(error.message.slice(0, 512))
    }))
  const restart = state.restart
  return {
    registration: state.registration,
    validation: state.validation,
    validationErrors,
    reason: ['no_schedule', 'no_future_run'].includes(state.reason)
      ? state.reason
      : null,
    lastAttemptAt:
      typeof state.lastAttemptAt === 'string' &&
      Number.isFinite(Date.parse(state.lastAttemptAt))
        ? new Date(state.lastAttemptAt).toISOString()
        : null,
    restart:
      restart &&
      restart.persistence === 'memory_only' &&
      ['relative_to_registration', 'wall_clock', 'none'].includes(
        restart.timing
      ) &&
      typeof restart.oneShot === 'boolean' &&
      restart.missedRuns === 'not_replayed'
        ? {
            persistence: restart.persistence,
            timing: restart.timing,
            oneShot: restart.oneShot,
            missedRuns: restart.missedRuns
          }
        : null
  }
}

function describeJob(job) {
  const inputs = Object.entries(job.inputs || {}).map(([name, field]) => {
    const secret =
      field.sensitive === true ||
      field.protect === true ||
      field.secret === true ||
      sensitive.test(name)
    const output = {
      name,
      type: field.type || 'ref',
      required: field.required === true,
      sensitive: secret
    }
    for (const key of [
      'friendlyName',
      'description',
      'allowNull',
      'isInteger',
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
        field.isEmail ||
        field.isURL ||
        field.regex ||
        !['string', 'number', 'boolean', 'json', 'ref'].includes(output.type)
    )
    return output
  })
  const schedule = job.schedule || {}
  const type = schedule.cron
    ? 'cron'
    : ['interval', 'timeout', 'date'].find(
        (key) => schedule[key] !== undefined && schedule[key] !== false
      ) || 'manual'
  const scheduleState = describeScheduleState(job.scheduleState)
  const safe = {
    name: job.name,
    script: job.script,
    friendlyName: job.friendlyName || job.name,
    description: job.description || '',
    inputMetadataAvailable: job.inputMetadataAvailable === true,
    inputs,
    schedule: type === 'manual' ? null : schedule[type],
    scheduleType: type,
    timezone: typeof schedule.timezone === 'string' ? schedule.timezone : null,
    nextRunAt: job.nextRunAt ? new Date(job.nextRunAt).getTime() : null,
    paused: typeof job.paused === 'boolean' ? job.paused : null,
    isRunning:
      Number.isSafeInteger(job.runningCount) && job.runningCount >= 0
        ? job.runningCount > 0
        : null,
    withoutOverlapping:
      typeof job.withoutOverlapping === 'boolean'
        ? job.withoutOverlapping
        : null,
    scheduled: typeof job.scheduled === 'boolean' ? job.scheduled : null,
    scheduledInputs: describeScheduledInputs(job.scheduledInputs, inputs),
    scheduleState
  }
  safe.metadataVersion = digest({
    name: safe.name,
    script: safe.script,
    inputs,
    schedule,
    inputMetadataAvailable: safe.inputMetadataAvailable,
    scheduledInputs: safe.scheduledInputs
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
          (field.isInteger === true && !Number.isInteger(value)) ||
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
    if (value !== null && field.isIn && !field.isIn.includes(value))
      throw fail(`${name} is not an allowed value.`, 'QUEST_INPUT_INVALID')
  }
  // Quest's normal machine invocation remains the final validator, including
  // required values supplied by source-owned job defaults and custom rules.
  return values
}

function reconcileStaleRegistration(identity, uid) {
  const filename = identity.socket.replace(/\.sock$/, '.json')
  const statIfPresent = (filename) => {
    try {
      return fs.lstatSync(filename)
    } catch (error) {
      if (error.code === 'ENOENT') return null
      throw error
    }
  }
  const registration = statIfPresent(filename)
  const socket = statIfPresent(identity.socket)
  if (!registration && !socket) return
  const reject = () => {
    throw fail(
      'An existing Quest runtime registration cannot be safely replaced.'
    )
  }
  if (
    !registration?.isFile() ||
    registration.uid !== uid ||
    registration.mode & 0o077 ||
    registration.size > 4096 ||
    !socket?.isSocket() ||
    socket.uid !== uid ||
    socket.mode & 0o077
  )
    reject()
  let previous
  try {
    previous = JSON.parse(fs.readFileSync(filename, 'utf8'))
  } catch {
    reject()
  }
  if (
    previous?.version !== 1 ||
    previous.appId !== identity.appId ||
    previous.deploymentId !== identity.deploymentId ||
    previous.pid !== identity.pid ||
    previous.socket !== identity.socket ||
    typeof previous.runtimeId !== 'string' ||
    !previous.runtimeId ||
    typeof previous.startTicks !== 'string' ||
    !/^\d+$/.test(previous.startTicks) ||
    previous.startTicks === identity.startTicks
  )
    reject()
  // A reused PID is authority only for this exact, private pair. Recheck inode
  // identity before unlinking; unrelated, replaced or live files stay intact.
  for (const [file, before] of [
    [filename, registration],
    [identity.socket, socket]
  ]) {
    const current = statIfPresent(file)
    if (!current || current.dev !== before.dev || current.ino !== before.ino)
      reject()
  }
  fs.unlinkSync(identity.socket)
  fs.unlinkSync(filename)
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
    listeners = [],
    logWindows = new Map(),
    ownedFiles = new Map()
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
      const evicted = completed?.[0] || runs.keys().next().value
      forgetQuestRedactor(sails, runs.get(evicted).runtimeId, evicted)
      runs.delete(evicted)
      logWindows.delete(evicted)
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
      info.capabilities?.runIdentity !== true ||
      info.capabilities?.childSchedulerSuppression !== true
    )
      throw fail('Upgrade the app’s Quest hook to use the resident runtime.')
    return info
  }
  function record(kind, data) {
    const info = getRuntime()
    if (
      data.admission === 'rejected_before_start' &&
      data.phase === 'validation'
    )
      return
    if (
      !data.runId ||
      data.runtimeId !== info.runtimeId ||
      !Number.isSafeInteger(data.sequence)
    )
      return
    const old = runs.get(data.runId)
    if (kind === 'log') {
      if (!old || terminal.has(old.state) || data.sequence <= old.sequence)
        return
      const redactor = questRedactor(sails, data, 'running')
      const clean = (text, truncated) => {
        const sanitized = redactor.text(text || '', {
          preserveWhitespace: true,
          live: true,
          tail: true,
          truncated
        })
        const bytes = Buffer.from(sanitized)
        let offset = Math.max(0, bytes.length - 32768)
        while (offset < bytes.length && (bytes[offset] & 0xc0) === 0x80)
          offset++
        return {
          value: bytes.subarray(offset).toString('utf8'),
          truncated: offset > 0 || Boolean(truncated)
        }
      }
      const stdout = clean(data.logs?.stdout, data.logs?.stdoutTruncated)
      const stderr = clean(data.logs?.stderr, data.logs?.stderrTruncated)
      const snapshot = {
        sequence: data.sequence,
        stdout: stdout.value,
        stderr: stderr.value,
        truncated: stdout.truncated || stderr.truncated
      }
      const window = logWindows.get(data.runId) || {
        entries: [],
        bytes: 0,
        droppedThrough: 0
      }
      const size = Buffer.byteLength(JSON.stringify(snapshot))
      if (size > 128 * 1024) return
      window.entries.push(snapshot)
      window.bytes += size
      while (window.entries.length > 16 || window.bytes > 128 * 1024) {
        const removed = window.entries.shift()
        window.bytes -= Buffer.byteLength(JSON.stringify(removed))
        window.droppedThrough = removed.sequence
      }
      logWindows.set(data.runId, window)
      remember({
        ...old,
        sequence: data.sequence,
        stdout: snapshot.stdout,
        stderr: snapshot.stderr,
        logsTruncated: snapshot.truncated
      })
      return
    }
    if (kind === 'skipped' && old) return
    if (old && (data.sequence <= old.sequence || terminal.has(old.state)))
      return
    const admission =
      ['running', 'skipped'].includes(kind) &&
      activeAdmission?.name === data.name
        ? activeAdmission
        : null
    const redactor = questRedactor(sails, data, kind)
    const boundedResult = safeResult(data.result, redactor, MAX_RESULT_BYTES)
    if (boundedResult.status === 'too_large') delete boundedResult.truncated
    const run = {
      ...old,
      runId: data.runId,
      jobName: data.name,
      runtimeId: info.runtimeId,
      deploymentId: String(deploymentId),
      sequence: data.sequence,
      state: kind,
      trigger:
        old?.trigger ||
        (admission
          ? 'manual'
          : ['manual', 'scheduled', 'cli'].includes(data.trigger)
          ? data.trigger
          : 'unknown'),
      actor: old?.actor || admission?.actor || null,
      requestId: old?.requestId || admission?.requestId || null,
      requestedAt:
        old?.requestedAt ||
        admission?.requestedAt ||
        milliseconds(data.startedAt) ||
        milliseconds(data.timestamp) ||
        now(),
      startedAt:
        kind === 'skipped'
          ? null
          : milliseconds(data.startedAt) ||
            old?.startedAt ||
            milliseconds(data.timestamp) ||
            now(),
      finishedAt: ['running', 'cancelling', 'unconfirmed'].includes(kind)
        ? null
        : milliseconds(data.finishedAt) ||
          milliseconds(data.timestamp) ||
          now(),
      duration: ['running', 'skipped', 'cancelling', 'unconfirmed'].includes(
        kind
      )
        ? null
        : Number.isFinite(data.duration)
        ? data.duration
        : null,
      exitCode: ['running', 'skipped', 'cancelling', 'unconfirmed'].includes(
        kind
      )
        ? null
        : kind === 'completed'
        ? 0
        : Number.isInteger(data.exitCode)
        ? data.exitCode
        : Number.isInteger(data.error?.code)
        ? data.error.code
        : null,
      signal:
        ['failed', 'cancelled'].includes(kind) &&
        typeof data.signal === 'string' &&
        /^SIG[A-Z0-9]{1,16}$/.test(data.signal)
          ? data.signal
          : null,
      result: [
        'running',
        'skipped',
        'cancelling',
        'unconfirmed',
        'cancelled'
      ].includes(kind)
        ? { status: 'unavailable' }
        : boundedResult,
      inputs: redactor.inputs(data.inputs, (value) =>
        safeValue(value, 0, new Set(), redactor)
      ),
      stdout:
        typeof data.logs?.stdout === 'string'
          ? logTail(
              data.logs.stdout,
              32768,
              redactor,
              data.logs.stdoutTruncated
            )
          : old?.stdout || null,
      stderr:
        typeof data.logs?.stderr === 'string'
          ? logTail(
              data.logs.stderr,
              32768,
              redactor,
              data.logs.stderrTruncated
            )
          : old?.stderr || null,
      logsTruncated: Boolean(
        data.logs?.stdoutTruncated ||
          data.logs?.stderrTruncated ||
          Buffer.byteLength(data.logs?.stdout || '') > 32768 ||
          Buffer.byteLength(data.logs?.stderr || '') > 32768
      ),
      error:
        kind === 'skipped'
          ? data.reason === 'paused'
            ? 'The job was paused; no script started.'
            : data.reason === 'already_running'
            ? 'An execution was already running; no script started.'
            : 'The runtime skipped this job; no script started.'
          : data.error
          ? redactor.text(data.error.message || String(data.error))
          : null
    }
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
          invoke: info.capabilities.inputMetadata === true,
          typedInputs: info.capabilities.inputMetadata === true,
          results: info.capabilities.businessResults === true,
          pause: typeof sails.quest.pause === 'function',
          resume: typeof sails.quest.resume === 'function',
          cancel:
            info.capabilities.cancellation === true &&
            typeof sails.quest.cancel === 'function',
          liveLogs: info.capabilities.liveLogs === true
        },
        jobs: metadata(),
        runs: [...runs.values()].map(summary)
      }
    if (message.command === 'logs') {
      const run = runs.get(message.runId)
      if (!run)
        throw fail(
          'This runtime no longer retains that run.',
          'QUEST_RUN_UNAVAILABLE'
        )
      if (
        !Number.isSafeInteger(message.afterSequence) ||
        message.afterSequence < 0
      )
        throw fail('Invalid log replay cursor.', 'QUEST_INPUT_INVALID')
      const window = logWindows.get(message.runId)
      return {
        runId: run.runId,
        runtimeId: run.runtimeId,
        sequence: run.sequence,
        state: run.state,
        live: info.capabilities.liveLogs === true,
        gap: Boolean(window?.droppedThrough > message.afterSequence),
        entries: (window?.entries || []).filter(
          (entry) => entry.sequence > message.afterSequence
        ),
        stdout: run.stdout || '',
        stderr: run.stderr || '',
        truncated: run.logsTruncated
      }
    }
    if (message.command === 'cancel') {
      const run = runs.get(message.runId)
      if (!run || run.runtimeId !== message.runtimeId)
        throw fail(
          'This runtime does not retain that run.',
          'QUEST_RUN_UNAVAILABLE'
        )
      if (terminal.has(run.state)) return { run: summary(run) }
      if (
        info.capabilities.cancellation !== true ||
        typeof sails.quest.cancel !== 'function'
      )
        throw fail('Owned cancellation is unsupported.')
      const request = sails.quest.cancel(run.runId)
      Promise.resolve(request).catch(() => {})
      if (
        runs.get(run.runId)?.state !== 'cancelling' &&
        !terminal.has(runs.get(run.runId)?.state)
      )
        throw fail(
          'The runtime did not confirm cancellation admission.',
          'QUEST_UNCONFIRMED'
        )
      return { run: summary(runs.get(run.runId)) }
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
      message.name.length > 128 ||
      !/^[a-zA-Z0-9_][a-zA-Z0-9_./-]*$/.test(message.name) ||
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
    if (
      info.capabilities.inputMetadata !== true ||
      job.inputMetadataAvailable !== true
    )
      throw fail(
        'This job has no loaded input schema. Deploy its source definition before running it.'
      )
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
    if (
      job.paused === null ||
      job.isRunning === null ||
      job.withoutOverlapping === null
    )
      throw fail('The job’s resident scheduler state is unavailable.')
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
      execution = Promise.reject(error)
    }
    activeAdmission = null
    if (admission.run) resolveAdmission({ run: summary(admission.run) })
    else {
      const unconfirmed = () =>
        rejectAdmission(
          fail(
            'The runtime did not confirm run admission. Do not repeat the job until its state is checked.',
            'QUEST_UNCONFIRMED'
          )
        )
      // Registered-job validation is synchronous, but public Quest.run returns
      // a rejected Promise. Preserve only the explicit pre-spawn marker; an
      // unmarked error or missing start remains an unknown execution outcome.
      Promise.resolve(execution).then(unconfirmed, (error) => {
        if (
          error?.code === 'E_QUEST_ADMISSION_REJECTED' &&
          error.admission === 'rejected_before_start' &&
          error.phase === 'validation'
        ) {
          rejectAdmission(
            fail(
              'The job was rejected before execution. Check the job definition and input values.',
              'QUEST_INPUT_INVALID'
            )
          )
        } else unconfirmed()
      })
      setImmediate(unconfirmed)
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
    reconcileStaleRegistration(identity, runtime.getuid())
    for (const [event, state] of [
      ['start', 'running'],
      ['complete', 'completed'],
      ['error', 'failed'],
      ['skip', 'skipped'],
      ['log', 'log'],
      ['cancelling', 'cancelling'],
      ['cancelled', 'cancelled'],
      ['unconfirmed', 'unconfirmed']
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
    ownedFiles.set(socketPath, fs.lstatSync(socketPath))
    fs.chmodSync(socketPath, 0o600)
    fs.writeFileSync(filename, JSON.stringify(identity), {
      mode: 0o600,
      flag: 'wx'
    })
    ownedFiles.set(filename, fs.lstatSync(filename))
    return true
  }
  async function stop() {
    for (const [event, listener] of listeners)
      sails.removeListener(event, listener)
    if (server) await new Promise((resolve) => server.close(resolve))
    for (const [file, owned] of ownedFiles) {
      try {
        const current = fs.lstatSync(file)
        if (current.dev === owned.dev && current.ino === owned.ino)
          fs.unlinkSync(file)
      } catch (error) {
        if (error.code !== 'ENOENT') throw error
      }
    }
    ownedFiles.clear()
    for (const run of runs.values())
      forgetQuestRedactor(sails, run.runtimeId, run.runId)
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
  safeResult,
  DIRECTORY
}
