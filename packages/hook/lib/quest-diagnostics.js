const MAX_QUEST_TRACE_BYTES = 64 * 1024
const ANSI_ESCAPE_PATTERN = /\u001B(?:[@-Z\\-_]|\[[0-?]*[ -/]*[@-~])/g
const SENSITIVE_ASSIGNMENT_PATTERN =
  /\b([A-Z0-9_]*(?:PASSWORD|PASSWD|SECRET|TOKEN|API_KEY|PRIVATE_KEY|CREDENTIAL)[A-Z0-9_]*)\s*=\s*([^\s,;]+)/gi
const BEARER_PATTERN = /\bBearer\s+[^\s,;]+/gi
const SENSITIVE_ENV_KEY_PATTERN =
  /(?:PASSWORD|PASSWD|SECRET|TOKEN|API_KEY|PRIVATE_KEY|CREDENTIAL)/i

function normalizeQuestDiagnostic(error, options = {}) {
  if (!error || typeof error !== 'object') {
    return null
  }

  const diagnostic = sanitizeQuestDiagnostic(error.diagnostic, options)
  const stack = sanitizeQuestDiagnostic(error.stack, options)
  const trace = [diagnostic, stack]
    .filter(Boolean)
    .filter((value, index, values) => values.indexOf(value) === index)
    .join('\n\nQuest runner:\n')

  return boundTail(trace, options.maxBytes || MAX_QUEST_TRACE_BYTES) || null
}

function sanitizeQuestDiagnostic(value, options = {}) {
  if (typeof value !== 'string' || value.trim() === '') {
    return ''
  }

  let sanitized = value
    .replace(ANSI_ESCAPE_PATTERN, '')
    .replace(BEARER_PATTERN, 'Bearer <redacted>')
    .replace(SENSITIVE_ASSIGNMENT_PATTERN, '$1=<redacted>')

  const environment = options.environment || process.env
  const secretValues = Object.entries(environment)
    .filter(
      ([key, secret]) =>
        SENSITIVE_ENV_KEY_PATTERN.test(key) &&
        typeof secret === 'string' &&
        secret.length >= 6
    )
    .map(([, secret]) => secret)
    .sort((left, right) => right.length - left.length)

  for (const secret of secretValues) {
    sanitized = sanitized.split(secret).join('<redacted>')
  }

  return sanitized.trim()
}

function boundTail(value, maxBytes) {
  if (!value) {
    return ''
  }

  const buffer = Buffer.from(value)
  if (buffer.length <= maxBytes) {
    return value
  }

  return buffer.subarray(buffer.length - maxBytes).toString('utf8')
}

module.exports = {
  MAX_QUEST_TRACE_BYTES,
  normalizeQuestDiagnostic,
  sanitizeQuestDiagnostic
}
