function injectBearingWidget(req, res, args, capability) {
  if (
    req.method !== 'GET' ||
    res.statusCode < 200 ||
    res.statusCode >= 300 ||
    res.getHeader('content-encoding') ||
    !String(res.getHeader('content-type') || '').includes('text/html') ||
    !allowsSameOriginScript(res.getHeader('content-security-policy'))
  ) {
    return args
  }

  const original = args[0]
  if (!Buffer.isBuffer(original) && typeof original !== 'string') return args
  const encoding = typeof args[1] === 'string' ? args[1] : 'utf8'
  const body = Buffer.isBuffer(original)
    ? original.toString(encoding)
    : original
  if (
    body.length > 2 * 1024 * 1024 ||
    body.includes('data-slipway-bearing') ||
    !/<\/body\s*>/i.test(body)
  ) {
    return args
  }

  const routePrefix = normalizeRoutePrefix(capability.routePrefix)
  const tag = `<script async data-slipway-bearing src="${routePrefix}/_slipway/bearing/bootstrap.js"></script>`
  const nextBody = body.replace(/<\/body\s*>/i, `${tag}</body>`)
  res.removeHeader('content-length')
  res.removeHeader('etag')
  const nextArgs = [...args]
  nextArgs[0] = Buffer.isBuffer(original)
    ? Buffer.from(nextBody, encoding)
    : nextBody
  return nextArgs
}

function allowsSameOriginScript(value) {
  const policy = String(value || '')
  if (!policy) return true
  const directives = policy
    .split(';')
    .map((part) => part.trim())
    .filter(Boolean)
  const directive =
    directives.find((part) => /^script-src-elem\s/i.test(part)) ||
    directives.find((part) => /^script-src\s/i.test(part)) ||
    directives.find((part) => /^default-src\s/i.test(part))
  if (!directive) return true
  const sources = directive.split(/\s+/).slice(1)
  return sources.includes("'self'") || sources.includes('*')
}

function normalizeRoutePrefix(value) {
  const prefix = String(value || '').replace(/^\/+|\/+$/g, '')
  return prefix && /^[A-Za-z0-9._~/-]+$/.test(prefix) ? `/${prefix}` : ''
}

module.exports = {
  allowsSameOriginScript,
  injectBearingWidget,
  normalizeRoutePrefix
}
