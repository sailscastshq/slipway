const { safeValue } = require('./quest-runtime')
const { sanitizeQuestDiagnostic } = require('./quest-diagnostics')
const ms = (value) =>
  Number.isFinite(value)
    ? value
    : Number.isFinite(Date.parse(value))
    ? Date.parse(value)
    : null
function text(value, limit) {
  const clean = sanitizeQuestDiagnostic(value || '')
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
  { sails, appId, deploymentId } = {}
) {
  if (!data.runId || !data.runtimeId || !Number.isSafeInteger(data.sequence))
    return null
  let inputs = {},
    result = { status: 'unavailable' }
  try {
    inputs = safeValue(data.inputs || {})
    const metadata = sails.quest?.metadata?.(data.name)
    for (const [name, field] of Object.entries(metadata?.inputs || {}))
      if (field.sensitive || field.protect || field.secret)
        inputs[name] = '<redacted>'
    result = safeValue(data.result || result)
    if (Buffer.byteLength(JSON.stringify(result)) > 16 * 1024)
      result = { status: 'too_large', truncated: true }
    if (Buffer.byteLength(JSON.stringify(inputs)) > 4096) inputs = {}
  } catch {
    result = { status: 'serialization_error' }
    inputs = {}
  }
  const stdout = text(data.logs?.stdout, 2048),
    stderr = text(data.logs?.stderr, 2048)
  return {
    runId: data.runId,
    runtimeId: data.runtimeId,
    sequence: data.sequence,
    appId: String(appId),
    deploymentId: String(deploymentId),
    jobName: data.name,
    state,
    trigger: data.trigger || 'scheduled',
    requestedAt: ms(data.startedAt || data.timestamp) || Date.now(),
    startedAt: ms(data.startedAt || data.timestamp),
    finishedAt:
      state === 'running'
        ? null
        : ms(data.finishedAt || data.timestamp) || Date.now(),
    duration: Number.isFinite(data.duration) ? data.duration : null,
    exitCode:
      state === 'completed'
        ? 0
        : Number.isInteger(data.exitCode)
        ? data.exitCode
        : null,
    inputs,
    result,
    stdout: data.logs ? stdout.value : null,
    stderr: data.logs ? stderr.value : null,
    logsTruncated:
      stdout.truncated ||
      stderr.truncated ||
      Boolean(data.logs?.stdoutTruncated || data.logs?.stderrTruncated),
    error: data.error
      ? text(data.error.message || String(data.error), 2048).value
      : null
  }
}
