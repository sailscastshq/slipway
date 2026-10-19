// Read-only projection of retained instance Quest evidence into the shared UI
// contract. It owns no scheduler, remote app identity, or operational controls.
const { createHash } = require('node:crypto')
const { describeJob, safeValue } = require('./contracts/quest-metadata')
const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/
const LOG_BYTES = 32768
const terminal = new Set([
  'completed',
  'failed',
  'skipped',
  'cancelled',
  'timed_out'
])
function time(value) {
  if (value === null || value === undefined || value === '') return null
  const parsed = typeof value === 'number' ? value : Date.parse(value)
  return Number.isFinite(parsed) ? parsed : null
}
function result(value) {
  if (!value) return { status: 'unavailable' }
  try {
    if (typeof value === 'string' && Buffer.byteLength(value) > 16384)
      return { status: 'too_large' }
    const parsed = typeof value === 'string' ? JSON.parse(value) : value
    if (
      ![
        'available',
        'undefined',
        'too_large',
        'unsupported',
        'serialization_error',
        'unavailable'
      ].includes(parsed?.status)
    )
      return { status: 'unavailable' }
    if (parsed.status === 'available' && !Object.hasOwn(parsed, 'value'))
      return { status: 'serialization_error' }
    const safe = { status: parsed.status }
    if (parsed.status === 'available') safe.value = safeValue(parsed.value)
    if (parsed.truncated === true) safe.truncated = true
    if (
      typeof parsed.exit === 'string' &&
      /^[a-zA-Z0-9_.:-]{1,128}$/.test(parsed.exit)
    )
      safe.exit = parsed.exit
    return Buffer.byteLength(JSON.stringify(safe)) <= 16384
      ? safe
      : { status: 'too_large' }
  } catch {
    return { status: 'serialization_error' }
  }
}
function normalizeRun(source) {
  const state = source.state === 'interrupted' ? 'unconfirmed' : source.state
  const startedAt = ['requested', 'skipped'].includes(state)
    ? null
    : time(source.startedAt)
  const finishedAt = terminal.has(state) ? time(source.finishedAt) : null
  const run = {
    runId: source.id,
    jobName: source.name,
    trigger: source.trigger,
    state,
    requestedAt: time(source.requestedAt ?? source.startedAt),
    startedAt,
    finishedAt,
    updatedAt: time(source.updatedAt ?? source.finishedAt ?? source.startedAt),
    duration:
      startedAt !== null && finishedAt !== null
        ? Math.max(0, finishedAt - startedAt)
        : null,
    sequence:
      Number.isSafeInteger(source.sequence) && source.sequence >= 0
        ? source.sequence
        : 0,
    exitCode: Number.isInteger(source.exitCode) ? source.exitCode : null,
    signal: source.signal || null,
    inputs: safeValue(source.inputs || {}),
    result: result(source.result),
    error:
      source.error ||
      source.reason ||
      (source.state === 'interrupted'
        ? 'Slipway restarted; completion is unknown. Check effects before running again.'
        : null),
    logsAvailable:
      typeof source.logs?.stdout === 'string' ||
      typeof source.logs?.stderr === 'string',
    logsTruncated: source.logs?.truncated === true
  }
  run.resultStatus = run.result.status
  run.revision = createHash('sha256')
    .update(JSON.stringify([run, source.logs]))
    .digest('hex')
  return run
}
function tail(value) {
  if (typeof value !== 'string') return ''
  const bytes = Buffer.from(value)
  let offset = Math.max(0, bytes.length - LOG_BYTES)
  while (offset < bytes.length && (bytes[offset] & 0xc0) === 0x80) offset++
  return bytes.subarray(offset).toString('utf8')
}
function logs(source) {
  const run = normalizeRun(source)
  return {
    runId: run.runId,
    stdout: tail(source.logs?.stdout),
    stderr: tail(source.logs?.stderr),
    available: run.logsAvailable,
    truncated:
      run.logsTruncated ||
      Buffer.byteLength(source.logs?.stdout || '') > LOG_BYTES ||
      Buffer.byteLength(source.logs?.stderr || '') > LOG_BYTES,
    sequence: run.sequence,
    state: run.state
  }
}
function normalize(snapshot, metadata = []) {
  const observedAt = Date.now()
  return {
    version: 1,
    scope: 'instance',
    mode: snapshot.available ? 'resident' : 'unavailable',
    runtimeState: snapshot.available ? 'live' : 'unknown',
    target: {},
    observedAt,
    capabilities: {
      invoke: false,
      pause: false,
      resume: false,
      cancel: false,
      liveLogs: false,
      results: true,
      typedInputs: false
    },
    jobs: (snapshot.jobs || []).map((job) => ({
      ...describeJob({
        ...metadata.find((item) => item.name === job.name),
        ...job
      }),
      executionScope: 'instance',
      manualAllowed: job.manualAllowed === true,
      ...(Object.hasOwn(job, 'cleanupEnabled')
        ? { cleanupEnabled: job.cleanupEnabled }
        : {})
    })),
    runs: (snapshot.runs || []).map(normalizeRun),
    legacyEvents: [],
    nextCursor: null,
    historyScope: 'Last 100 retained instance runs',
    reason: snapshot.error || null
  }
}
async function read(sails) {
  const snapshot = await sails.instanceQuest.snapshot()
  let metadata = []
  try {
    const value = sails.quest?.metadata?.()
    if (Array.isArray(value)) metadata = value
  } catch {
    /* Missing metadata remains unavailable. */
  }
  return { ...snapshot, workspace: normalize(snapshot, metadata) }
}
module.exports = { UUID, normalize, normalizeRun, logs, read }
