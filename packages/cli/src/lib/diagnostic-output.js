// The server masks configured values. This second boundary protects recognizable
// credential fields and URLs even when talking to an older server.
export function safeDiagnostic(value) {
  if (typeof value === 'string')
    return value
      .replace(/([a-z][a-z0-9+.-]*:\/\/)([^\s/]*@)/gi, '$1[REDACTED]@')
      .replace(
        /([?&](?:password|secret|token|api[_-]?key|signature|credential|x-amz-[a-z-]+|x-goog-[a-z-]+)=)[^&#\s]*/gi,
        '$1[REDACTED]'
      )
      .replace(/\b(Bearer|Basic)\s+[A-Za-z0-9+/_=.-]+/gi, '$1 [REDACTED]')
  if (!value || typeof value !== 'object') return value
  if (Array.isArray(value)) return value.map(safeDiagnostic)
  return Object.fromEntries(
    Object.entries(value).map(([key, entry]) => [
      key,
      !(typeof entry === 'boolean' && /^has[A-Z]/.test(key)) &&
      /password|secret|token|credential|authorization|encrypted|privatekey|accesskey|apikey/i.test(
        key.replace(/[^a-z]/gi, '')
      )
        ? entry == null
          ? entry
          : '[REDACTED]'
        : safeDiagnostic(entry)
    ])
  )
}
