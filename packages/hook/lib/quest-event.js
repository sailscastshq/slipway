const { safeValue, safeResult } = require('./quest-runtime')
const { questRedactor } = require('./quest-redaction')
const ms = (value) =>
  Number.isFinite(value)
    ? value
    : Number.isFinite(Date.parse(value))
    ? Date.parse(value)
    : null
function text(value, limit, redactor, truncated = false) {
  const clean = redactor.text(value || '', { truncated })
  const bytes = Buffer.from(clean)
  let offset = Math.max(0, bytes.length - limit)
  while (offset < bytes.length && (bytes[offset] & 0xc0) === 0x80) offset++
  return {
    value: bytes.subarray(offset).toString('utf8'),
    truncated: offset > 0
  }
}
module.exports = function questEvent(
  data,
  state,
  { sails, appId, deploymentId, redactor } = {}
) {
  if (data.admission === 'rejected_before_start') return null
  if (!data.runId || !data.runtimeId || !Number.isSafeInteger(data.sequence))
    return null
  redactor ||= questRedactor(sails, data, state)
  let inputs = {},
    result = { status: 'unavailable' }
  try {
    inputs = redactor.inputs(data.inputs, (value) =>
      safeValue(value, 0, new Set(), redactor)
    )
    result = safeResult(data.result, redactor, 16 * 1024)
    if (Buffer.byteLength(JSON.stringify(inputs)) > 4096) inputs = {}
  } catch {
    result = { status: 'serialization_error' }
    inputs = {}
  }
  const stdout = text(
      data.logs?.stdout,
      2048,
      redactor,
      data.logs?.stdoutTruncated
    ),
    stderr = text(data.logs?.stderr, 2048, redactor, data.logs?.stderrTruncated)
  const skipped = state === 'skipped'
  return {
    runId: data.runId,
    runtimeId: data.runtimeId,
    sequence: data.sequence,
    appId: String(appId),
    deploymentId: String(deploymentId),
    jobName: data.name,
    state,
    trigger: ['manual', 'scheduled', 'cli'].includes(data.trigger)
      ? data.trigger
      : 'unknown',
    requestedAt: ms(data.startedAt || data.timestamp) || Date.now(),
    startedAt: skipped ? null : ms(data.startedAt || data.timestamp),
    finishedAt:
      state === 'running'
        ? null
        : ms(data.finishedAt || data.timestamp) || Date.now(),
    duration: !skipped && Number.isFinite(data.duration) ? data.duration : null,
    exitCode: skipped
      ? null
      : state === 'completed'
      ? 0
      : Number.isInteger(data.exitCode)
      ? data.exitCode
      : null,
    signal:
      state === 'failed' &&
      typeof data.signal === 'string' &&
      /^SIG[A-Z0-9]{1,16}$/.test(data.signal)
        ? data.signal
        : null,
    inputs,
    result: skipped ? { status: 'unavailable' } : result,
    stdout: !skipped && data.logs ? stdout.value : null,
    stderr: !skipped && data.logs ? stderr.value : null,
    logsTruncated:
      !skipped &&
      (stdout.truncated ||
        stderr.truncated ||
        Boolean(data.logs?.stdoutTruncated || data.logs?.stderrTruncated)),
    error: skipped
      ? text(data.reason || 'The job did not start.', 2048, redactor).value
      : data.error
      ? text(data.error.message || String(data.error), 2048, redactor).value
      : null
  }
}
