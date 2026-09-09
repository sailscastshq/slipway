const crypto = require('node:crypto')
const AGE = 90 * 86400000
const IDLE = 30 * 60000
function signature(secret, body, name) {
  return crypto
    .createHmac('sha256', secret)
    .update('wake-visitor:' + name + ':' + body)
    .digest('base64url')
}
function read(req, name, secret, now) {
  const token = String(req.headers.cookie || '')
    .split(';')
    .map((part) => part.trim())
    .find((part) => part.startsWith(name + '='))
    ?.slice(name.length + 1)
  if (!token || token.length > 2048) return null
  const [body, mac, extra] = token.split('.')
  if (!body || !mac || extra) return null
  const expected = Buffer.from(signature(secret, body, name)),
    actual = Buffer.from(mac)
  if (
    expected.length !== actual.length ||
    !crypto.timingSafeEqual(expected, actual)
  )
    return null
  try {
    const value = JSON.parse(Buffer.from(body, 'base64url').toString())
    if (
      !/^[a-f0-9]{32}$/.test(value.visitor) ||
      !/^[a-f0-9]{32}$/.test(value.session) ||
      !Number.isSafeInteger(value.born) ||
      !Number.isSafeInteger(value.seen) ||
      value.born > now ||
      now - value.born >= AGE ||
      value.seen > now ||
      (value.subject !== null && !/^[a-f0-9]{64}$/.test(value.subject))
    )
      return null
    return value
  } catch {
    return null
  }
}
function append(res, cookie) {
  const current = res.getHeader('set-cookie')
  res.setHeader('set-cookie', [
    ...(Array.isArray(current) ? current : current ? [current] : []),
    cookie
  ])
}
function cookieName(config) {
  return `sw_wake_${config.appId}`
}
function attributes(config, secure) {
  return `Path=${config.routePath || '/'}; HttpOnly; SameSite=Lax${
    secure ? '; Secure' : ''
  }`
}
function clear(req, res, config, secure) {
  append(
    res,
    `${cookieName(config)}=; Max-Age=0; ${attributes(config, secure)}`
  )
}
function resolve(req, res, config, identity, secure, now = Date.now()) {
  const name = cookieName(config)
  const previous = read(req, name, config.secret, now)
  const subject = identity
    ? crypto
        .createHmac('sha256', config.secret)
        .update('wake-subject:' + identity.id)
        .digest('hex')
    : null
  const changed = Boolean(previous?.subject && previous.subject !== subject)
  const random = () => crypto.randomBytes(16).toString('hex')
  const value =
    !previous || changed
      ? { visitor: random(), session: random(), born: now, seen: now, subject }
      : { ...previous, subject }
  if (now - value.seen >= IDLE) value.session = random()
  value.seen = now
  const body = Buffer.from(JSON.stringify(value)).toString('base64url')
  append(
    res,
    `${name}=${body}.${signature(
      config.secret,
      body,
      name
    )}; Max-Age=${Math.max(
      1,
      Math.floor((AGE - (now - value.born)) / 1000)
    )}; ${attributes(config, secure)}`
  )
  return {
    visitorId: value.visitor,
    sessionId: value.session,
    hostUserId: identity?.id || null,
    changed,
    previousVisitor: previous?.visitor
  }
}
module.exports = { read, clear, resolve, cookieName }
