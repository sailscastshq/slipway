export const LOG_LEVELS = Object.freeze(['error', 'warning', 'info', 'debug'])

const ANSI_ESCAPE_PATTERN =
  // eslint-disable-next-line no-control-regex
  /[\u001B\u009B][[\]()#;?]*(?:(?:(?:[a-zA-Z\d]*(?:;[-a-zA-Z\d\/#&.:=?%@~_]+)*)?\u0007)|(?:(?:\d{1,4}(?:[;:]\d{0,4})*)?[\dA-PR-TZcf-nq-uy=><~]))/g
const TIMESTAMP_PATTERN =
  /^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z?)\s?(.*)$/s
const TOKEN_PATTERN =
  /(https?:\/\/[^\s"'<>]+|\/api\/[^\s"'<>]+|\b(?:GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS)\b|\b[1-5]\d{2}\b|\b(?:fatal|exception|error|err|warning|warn|info|debug|verbose)\b|\[[^\]]+\])/gi

export function parseLogLine(line) {
  const raw = String(line ?? '')
  const display = raw.replace(ANSI_ESCAPE_PATTERN, '').replace(/\r$/, '')
  const timestampMatch = display.match(TIMESTAMP_PATTERN)
  const timestamp = timestampMatch?.[1] || ''
  const message = timestampMatch ? timestampMatch[2] : display
  const statusMatches = findHttpStatusMatches(message)
  const statusCodes = statusMatches.map((match) => match.code)
  const continuation = isContinuation(message)
  const level = inferLogLevel(message, statusCodes, continuation)

  return {
    raw,
    timestamp,
    time: compactTimestamp(timestamp),
    message,
    level,
    continuation,
    statusCodes,
    segments: tokenizeLogMessage(message, statusMatches)
  }
}

export function filterLogEntries(entries, { query = '', level = 'all' } = {}) {
  const needle = query.trim().toLocaleLowerCase()

  return entries.filter((entry) => {
    const matchesLevel =
      level === 'all' ||
      entry.level === level ||
      (level === 'info' && entry.level === 'continuation')
    const matchesQuery =
      !needle || entry.raw.toLocaleLowerCase().includes(needle)

    return matchesLevel && matchesQuery
  })
}

export function serializeLogEntries(entries) {
  return entries.map((entry) => entry.raw).join('\n')
}

export function tokenizeLogMessage(
  message,
  statusMatches = findHttpStatusMatches(message)
) {
  const segments = []
  const statusIndexes = new Set(statusMatches.map((match) => match.index))
  let cursor = 0

  for (const match of message.matchAll(TOKEN_PATTERN)) {
    const index = match.index ?? 0
    if (index > cursor) {
      segments.push({ type: 'text', text: message.slice(cursor, index) })
    }

    segments.push({
      type: tokenType(match[0], statusIndexes.has(index)),
      text: match[0]
    })
    cursor = index + match[0].length
  }

  if (cursor < message.length) {
    segments.push({ type: 'text', text: message.slice(cursor) })
  }

  return segments.length > 0 ? segments : [{ type: 'text', text: message }]
}

function compactTimestamp(timestamp) {
  const match = timestamp.match(/T(\d{2}:\d{2}:\d{2})(?:\.(\d+))?/)
  if (!match) return ''

  const milliseconds = (match[2] || '').slice(0, 3).padEnd(3, '0')
  return milliseconds ? `${match[1]}.${milliseconds}` : match[1]
}

function inferLogLevel(message, statusCodes, continuation) {
  if (
    statusCodes.some((code) => code >= 500) ||
    /\b(?:fatal|exception|error|err|emaxbuffer)\b/i.test(message)
  ) {
    return 'error'
  }
  if (
    statusCodes.some((code) => code >= 400) ||
    /\b(?:warning|warn)\b/i.test(message)
  ) {
    return 'warning'
  }
  if (/\b(?:debug|verbose|silly)\b/i.test(message)) return 'debug'
  if (continuation) return 'continuation'
  return 'info'
}

function isContinuation(message) {
  return /^(?:\s+at\s|\s*at\s|\s*Caused by:|\s*code:\s|\s*[}\]])/.test(message)
}

function findHttpStatusMatches(message) {
  const matches = []
  const seenIndexes = new Set()
  const patterns = [
    /\b(?:GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS)\s+\S+\s+([1-5]\d{2})\b/gi,
    /\bHTTP(?:\/\d(?:\.\d)?)?\s+([1-5]\d{2})\b/gi,
    /\b(?:status(?:Code)?|response status)\s*(?::|=|is|was)?\s*([1-5]\d{2})\b/gi,
    /\b([1-5]\d{2})\s+(?:error|response|redirect|ok|created|no content|bad request|unauthorized|forbidden|not found|internal server error|service unavailable)\b/gi
  ]

  for (const pattern of patterns) {
    for (const match of message.matchAll(pattern)) {
      const codeText = match[1]
      const index = (match.index ?? 0) + match[0].lastIndexOf(codeText)
      if (seenIndexes.has(index)) continue
      seenIndexes.add(index)
      matches.push({ code: Number(codeText), index })
    }
  }

  return matches.sort((left, right) => left.index - right.index)
}

function tokenType(token, isHttpStatus = false) {
  if (/^https?:\/\//i.test(token)) return 'url'
  if (/^\/api\//.test(token)) return 'path'
  if (/^(?:GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS)$/i.test(token)) {
    return 'method'
  }
  if (/^[1-5]\d{2}$/.test(token)) {
    if (!isHttpStatus) return 'text'
    const code = Number(token)
    if (code >= 500) return 'status-error'
    if (code >= 400) return 'status-warning'
    if (code >= 300) return 'status-redirect'
    return 'status-success'
  }
  if (/^(?:fatal|exception|error|err)$/i.test(token)) return 'error'
  if (/^(?:warning|warn)$/i.test(token)) return 'warning'
  if (/^info$/i.test(token)) return 'info'
  if (/^(?:debug|verbose)$/i.test(token)) return 'debug'
  if (/^\[.*\]$/.test(token)) return 'tag'
  return 'text'
}
