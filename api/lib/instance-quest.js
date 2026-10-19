const fs = require('node:fs/promises')
const path = require('node:path')
const { randomUUID } = require('node:crypto')

const JOBS = Object.freeze([
  'check-for-updates',
  'check-system-databases',
  'expire-bridge-support',
  'maintain-observability',
  'maintain-wake',
  'reconcile-deployments',
  'run-scheduled-backups',
  'retain-deployment-images'
])
const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/
const ACTIVE = new Set(['requested', 'running', 'cancelling', 'unconfirmed'])
const LIMIT = 100
const LOG_BYTES = 32768

function create(sails) {
  const root = path.join(sails.config.appPath, 'db', 'instance-quest')
  const runs = new Map()
  const pending = new Map()
  const identities = new Map()
  let writes = Promise.resolve()
  let storageError = null
  let stopped = false
  const listeners = []
  function redact(value) {
    if (!sails.hooks.secrets?.text)
      throw new Error('Instance Quest redaction is unavailable.')
    return sails.hooks.secrets.text(String(value ?? ''))
  }
  function text(value, bytes = LOG_BYTES) {
    // Redact the complete bounded upstream snapshot before truncating it.
    return Buffer.from(redact(value)).subarray(-bytes).toString('utf8')
  }
  function filename(id) {
    return path.join(root, `${id}.json`)
  }
  async function save(run, exclusive = false) {
    const encoded = JSON.stringify(run)
    if (exclusive)
      return fs.writeFile(filename(run.id), encoded, {
        flag: 'wx',
        mode: 0o600
      })
    const tmp = path.join(root, `.${randomUUID()}.tmp`)
    await fs.writeFile(tmp, encoded, { mode: 0o600 })
    await fs.rename(tmp, filename(run.id))
  }
  function enqueue(work) {
    writes = writes.then(work).catch((error) => {
      storageError = new Error(
        'Instance Quest history could not be persisted. Manual runs are disabled.'
      )
      sails.log.error(
        'Instance Quest history write failed:',
        text(error.message, 2048)
      )
    })
  }
  function receive(event, data) {
    if (stopped || !JOBS.includes(data.name) || !UUID.test(data.runId || ''))
      return
    const id =
      identities.get(data.runId) ||
      (data.trigger === 'manual' && pending.get(data.name)) ||
      data.runId
    identities.set(data.runId, id)
    // Capture in emission order, synchronously with Quest admission.
    const prior = runs.get(id)
    const run = {
      ...prior,
      id,
      runtimeRunId: data.runId,
      name: data.name,
      trigger: data.trigger === 'scheduled' ? 'scheduled' : 'manual',
      startedAt: new Date(data.startedAt || Date.now()).toISOString(),
      state:
        {
          start: 'running',
          complete: 'completed',
          error: 'failed',
          skip: 'skipped'
        }[event] || event
    }
    if (event !== 'start' && event !== 'log' && event !== 'cancelling')
      run.finishedAt = new Date(data.finishedAt || Date.now()).toISOString()
    if (event === 'log') run.state = prior?.state || 'running'
    if (data.logs)
      run.logs = {
        stdout: text(data.logs.stdout),
        stderr: text(data.logs.stderr),
        truncated: Boolean(
          data.logs.stdoutTruncated ||
            data.logs.stderrTruncated ||
            Buffer.byteLength(data.logs.stdout || '') > LOG_BYTES ||
            Buffer.byteLength(data.logs.stderr || '') > LOG_BYTES
        )
      }
    if (data.error) run.error = text(data.error.message, 4096)
    if (data.reason) run.reason = text(data.reason, 1024)
    // Results can contain credentials or huge nested payloads: retain a bounded,
    // redacted text representation rather than serializing arbitrary instances.
    if (data.result)
      run.result = text(
        JSON.stringify(sails.hooks.secrets.protect(data.result)),
        16384
      )
    runs.set(id, run)
    const snapshot = structuredClone(run)
    enqueue(async () => {
      if (runs.has(snapshot.id)) await save(snapshot)
      await prune()
    })
    if (!ACTIVE.has(run.state)) identities.delete(data.runId)
  }
  async function prune() {
    const ordered = [...runs.values()]
      .filter((run) => !ACTIVE.has(run.state))
      .sort((a, b) => b.startedAt.localeCompare(a.startedAt))
    for (const run of ordered.slice(LIMIT)) {
      await fs.unlink(filename(run.id)).catch((error) => {
        if (error.code !== 'ENOENT') throw error
      })
      runs.delete(run.id)
    }
  }
  async function initialize() {
    await fs.mkdir(root, { recursive: true, mode: 0o700 })
    const files = (await fs.readdir(root)).filter(
      (name) => UUID.test(name.slice(0, -5)) && name.endsWith('.json')
    )
    if (files.length > 1000)
      throw new Error('Instance Quest history exceeds recovery limit.')
    for (const name of files) {
      const file = path.join(root, name)
      if ((await fs.stat(file)).size > 128 * 1024)
        throw new Error('Instance Quest history exceeds record limit.')
      const run = JSON.parse(await fs.readFile(file, 'utf8'))
      if (`${run.id}.json` !== name || !JOBS.includes(run.name))
        throw new Error('Invalid instance Quest history.')
      if (ACTIVE.has(run.state)) {
        run.state = 'interrupted'
        run.error =
          'Slipway restarted; completion is unknown. Check effects before running again.'
        run.finishedAt = new Date().toISOString()
        await save(run)
      }
      runs.set(run.id, run)
    }
    await prune()
    for (const event of [
      'start',
      'log',
      'complete',
      'error',
      'skip',
      'cancelled',
      'cancelling',
      'unconfirmed'
    ]) {
      const listener = (data) => receive(event, data)
      sails.on(`quest:job:${event}`, listener)
      listeners.push([`quest:job:${event}`, listener])
    }
  }
  async function snapshot() {
    await writes
    const available = typeof sails.quest?.metadata === 'function'
    const jobs = available
      ? sails.quest
          .metadata()
          .filter((job) => JOBS.includes(job.name))
          .map((job) => ({
            name: job.name,
            friendlyName: job.friendlyName,
            description: job.description,
            schedule: job.schedule,
            scheduled: job.scheduled,
            nextRunAt: job.nextRunAt,
            paused: job.paused,
            runningCount: job.runningCount,
            ...(job.name === 'retain-deployment-images'
              ? {
                  cleanupEnabled: sails.config.imageRetention?.remove === true
                }
              : {}),
            manualAllowed:
              !storageError &&
              !stopped &&
              !pending.has(job.name) &&
              !job.runningCount &&
              !job.paused &&
              job.withoutOverlapping !== false
          }))
      : []
    return {
      available,
      error: storageError?.message || null,
      jobs,
      runs: [...runs.values()]
        .sort((a, b) => b.startedAt.localeCompare(a.startedAt))
        .slice(0, LIMIT),
      liveLogs:
        sails.config.quest?.runtimeControls === true &&
        process.platform === 'linux'
    }
  }
  async function trigger(name, requestId, inputs = {}) {
    if (
      !JOBS.includes(name) ||
      !UUID.test(requestId || '') ||
      !inputs ||
      typeof inputs !== 'object' ||
      Array.isArray(inputs) ||
      (Object.keys(inputs).length &&
        !(
          name === 'retain-deployment-images' &&
          Object.keys(inputs).length === 1 &&
          typeof inputs.preview === 'boolean'
        ))
    )
      throw Object.assign(
        new Error(
          'Choose a registered instance job. Only deployment-image cleanup accepts a boolean preview input.'
        ),
        { status: 400 }
      )
    await writes
    if (storageError || stopped)
      throw Object.assign(
        new Error(storageError?.message || 'Instance Quest is stopping.'),
        { status: 503 }
      )
    const jobInputs = inputs.preview === true ? { preview: true } : {}
    const existing = runs.get(requestId)
    if (existing) {
      if (
        existing.name !== name ||
        JSON.stringify(existing.inputs || {}) !== JSON.stringify(jobInputs)
      )
        throw Object.assign(
          new Error('Request identity belongs to a different job or mode.'),
          { status: 409 }
        )
      return { run: existing, duplicate: true }
    }
    const job = sails.quest?.metadata?.(name)
    if (
      !job ||
      !sails.quest.get(name) ||
      job.withoutOverlapping === false ||
      job.runningCount ||
      job.paused ||
      pending.has(name)
    )
      throw Object.assign(
        new Error('This instance job is unavailable or already running.'),
        { status: 409 }
      )
    pending.set(name, requestId)
    const run = {
      id: requestId,
      name,
      inputs: jobInputs,
      state: 'requested',
      trigger: 'manual',
      startedAt: new Date().toISOString(),
      logs: { stdout: '', stderr: '' }
    }
    try {
      // Persist admission before invoking the existing Quest executor. A repeated
      // request never re-executes, including after an interrupted web response.
      await save(run, true)
      runs.set(run.id, run)
      const execution = sails.quest.run(name, jobInputs)
      Promise.resolve(execution)
        .catch((error) => {
          enqueue(async () => {
            const current = runs.get(run.id)
            if (ACTIVE.has(current?.state)) {
              current.state = 'failed'
              current.error = text(error.message, 4096)
              current.finishedAt = new Date().toISOString()
              await save(current)
            }
          })
        })
        .finally(() => pending.delete(name))
      return { run: runs.get(run.id), duplicate: false }
    } catch (error) {
      pending.delete(name)
      // A persisted admission must remain visible, and cannot be replayed.
      if (runs.has(run.id)) {
        run.state = 'failed'
        run.error = text(error.message, 4096)
        runs.set(run.id, run)
        await save(run)
      }
      throw error
    }
  }
  async function close() {
    stopped = true
    for (const [event, listener] of listeners)
      sails.removeListener(event, listener)
    await writes
  }
  return { initialize, snapshot, trigger, close }
}
module.exports = { create, JOBS }
