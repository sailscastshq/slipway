// Wire budgets mirror /api/v1/telemetry/ingest. This is a best-effort packetizer,
// not a delivery queue: callers detach a buffer once and never replay a packet.
const EVENT_BYTES = 32 * 1024
const BATCH_BYTES = 512 * 1024
const COUNTS = Object.freeze({ spans: 500, exceptions: 200, metrics: 1000 })
const KINDS = Object.keys(COUNTS)

function questTimestamp(value, now = Date.now()) {
  const parsed =
    typeof value === 'number'
      ? value
      : value instanceof Date
      ? value.getTime()
      : typeof value === 'string'
      ? Date.parse(value)
      : NaN
  return Number.isFinite(parsed) ? parsed : now
}

function encodedObject(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  try {
    const json = JSON.stringify(value)
    return json?.startsWith('{') ? json : null
  } catch {
    return null
  }
}

function jsonTail(value, limit) {
  if (typeof value !== 'string') return value
  let low = 0,
    high = value.length
  while (low < high) {
    const start = Math.floor((low + high) / 2)
    if (Buffer.byteLength(JSON.stringify(value.slice(start))) > limit)
      low = start + 1
    else high = start
  }
  // Do not begin a retained string with half of a UTF-16 surrogate pair.
  const code = value.charCodeAt(low)
  if (low && code >= 0xdc00 && code <= 0xdfff) low++
  return value.slice(low)
}

function questWireEnvelope(kind, event, json) {
  if (!json || Buffer.byteLength(json) <= EVENT_BYTES) return json
  if (kind === 'exceptions' && event.exceptionType === 'QuestJobError') {
    return encodedObject({
      ...event,
      message: jsonTail(event.message, 2048),
      stackTrace: event.stackTrace
        ? '[truncated telemetry diagnostic]\n' +
          jsonTail(event.stackTrace, 16 * 1024)
        : null
    })
  }
  const source = event.attributes?.questRun
  if (
    kind !== 'metrics' ||
    typeof event.name !== 'string' ||
    !event.name.startsWith('quest.job.') ||
    !source?.runId ||
    !source.runtimeId ||
    !source.state
  )
    return json
  const run = { ...source }
  const bounded = {
    ...event,
    attributes: { ...event.attributes, questRun: run }
  }
  // Result is the primary business evidence. Account for JSON escaping in log
  // tails before sacrificing the result, and never rewrite lifecycle identity.
  for (const field of ['stdout', 'stderr']) {
    const tail = jsonTail(run[field], 1024)
    if (tail !== run[field]) {
      run[field] = tail
      run.logsTruncated = true
    }
  }
  for (const record of [run, bounded.attributes]) {
    const tail = jsonTail(record.error, 1000)
    if (tail !== record.error) record.error = '[truncated] ' + tail
  }
  json = encodedObject(bounded)
  if (json && Buffer.byteLength(json) <= EVENT_BYTES) return json
  run.inputs = {}
  run.inputsTruncated = true
  json = encodedObject(bounded)
  if (json && Buffer.byteLength(json) <= EVENT_BYTES) return json
  const exit = source.result?.exit
  run.result = {
    status: 'too_large',
    truncated: true,
    ...(typeof exit === 'string' && /^[a-zA-Z0-9_.:-]{1,128}$/.test(exit)
      ? { exit }
      : {})
  }
  return encodedObject(bounded)
}

function* telemetryPayloads(input, onDrop = () => {}) {
  let registration = input.registration
    ? encodedObject(input.registration)
    : null
  if (
    input.registration &&
    (!registration || Buffer.byteLength(registration) > EVENT_BYTES)
  ) {
    registration = null
    onDrop('registration')
  }
  const suffix = registration ? `,"registration":${registration}}` : '}'
  const envelope = (parts) =>
    `{"spans":[${parts.spans.join(',')}],"exceptions":[${parts.exceptions.join(
      ','
    )}],"metrics":[${parts.metrics.join(',')}]${suffix}`
  const empty = () => ({ spans: [], exceptions: [], metrics: [] })
  let parts = empty()
  const overhead = Buffer.byteLength(envelope(parts))
  let bytes = overhead
  let count = 0
  let emitted = false
  for (const kind of KINDS) {
    for (const event of input[kind] || []) {
      const json = questWireEnvelope(kind, event, encodedObject(event))
      const size = json ? Buffer.byteLength(json) : Infinity
      // An invalid individual event cannot poison valid neighboring receipts.
      // Do not guess how to truncate arbitrary non-Quest telemetry structures.
      if (size > EVENT_BYTES) {
        onDrop(kind)
        continue
      }
      const added = size + (parts[kind].length ? 1 : 0)
      if (parts[kind].length >= COUNTS[kind] || bytes + added > BATCH_BYTES) {
        yield envelope(parts)
        emitted = true
        parts = empty()
        bytes = overhead
        count = 0
      }
      bytes += size + (parts[kind].length ? 1 : 0)
      parts[kind].push(json)
      count++
    }
  }
  if (count || (!emitted && registration)) yield envelope(parts)
}

module.exports = {
  questTimestamp,
  telemetryPayloads,
  EVENT_BYTES,
  BATCH_BYTES,
  COUNTS
}
