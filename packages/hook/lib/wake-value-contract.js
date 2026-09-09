const crypto = require('node:crypto')
const DAY = 86400000
const RETENTION_DAYS = 396 // Thirteen months, expressed as a fixed reporting window.
function failure(code) {
  return Object.assign(Error(code), { code })
}
function payment(value, now = Date.now()) {
  if (
    !value ||
    typeof value !== 'object' ||
    Array.isArray(value) ||
    Object.keys(value).some(
      (key) =>
        ![
          'transactionId',
          'adjustmentId',
          'amount',
          'currency',
          'occurredAt',
          'attributionId'
        ].includes(key)
    )
  )
    throw failure('invalid_payment')
  for (const key of [
    'transactionId',
    ...(value.adjustmentId === undefined ? [] : ['adjustmentId'])
  ])
    if (
      typeof value[key] !== 'string' ||
      !/^[A-Za-z0-9][A-Za-z0-9_.:/-]{0,127}$/.test(value[key])
    )
      throw failure('invalid_key')
  if (
    !Number.isSafeInteger(value.amount) ||
    value.amount < 0 ||
    value.amount > 1e12
  )
    throw failure('invalid_amount')
  if (
    typeof value.currency !== 'string' ||
    !Intl.supportedValuesOf('currency').includes(value.currency) ||
    ['XXX', 'XTS'].includes(value.currency)
  )
    throw failure('invalid_currency')
  if (
    !Number.isSafeInteger(value.occurredAt) ||
    value.occurredAt > now + 300000 ||
    value.occurredAt < now - RETENTION_DAYS * DAY
  )
    throw failure('invalid_time')
  if (
    value.attributionId !== undefined &&
    (typeof value.attributionId !== 'string' ||
      value.attributionId.length > 2048)
  )
    throw failure('invalid_attribution')
  return { ...value }
}
function properties(value = {}) {
  if (
    !value ||
    typeof value !== 'object' ||
    Array.isArray(value) ||
    Object.keys(value).length > 10
  )
    throw failure('invalid_properties')
  for (const [key, item] of Object.entries(value)) {
    if (
      !/^[a-z][a-z0-9_]{0,31}$/.test(key) ||
      /password|token|secret|email|name|address|phone|cookie|authorization/i.test(
        key
      ) ||
      !['string', 'number', 'boolean'].includes(typeof item) ||
      (typeof item === 'string' &&
        (item.length > 120 || /[\x00-\x1f\x7f]/.test(item))) ||
      (typeof item === 'number' && !Number.isFinite(item))
    )
      throw failure('invalid_properties')
  }
  return value
}
function attribution(secret, app, visitorId, now = Date.now()) {
  const iv = crypto.randomBytes(12),
    key = crypto
      .createHash('sha256')
      .update('wake-attribution:' + secret)
      .digest()
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv)
  cipher.setAAD(Buffer.from(String(app)))
  const body = Buffer.concat([
    cipher.update(JSON.stringify({ visitorId, issuedAt: now }), 'utf8'),
    cipher.final()
  ])
  return Buffer.concat([iv, cipher.getAuthTag(), body]).toString('base64url')
}
function readAttribution(token, secret, app, now = Date.now()) {
  try {
    if (typeof token !== 'string' || token.length > 2048) return null
    const bytes = Buffer.from(token, 'base64url')
    const decipher = crypto.createDecipheriv(
      'aes-256-gcm',
      crypto
        .createHash('sha256')
        .update('wake-attribution:' + secret)
        .digest(),
      bytes.subarray(0, 12)
    )
    decipher.setAAD(Buffer.from(String(app)))
    decipher.setAuthTag(bytes.subarray(12, 28))
    const data = JSON.parse(
      Buffer.concat([
        decipher.update(bytes.subarray(28)),
        decipher.final()
      ]).toString()
    )
    return /^[a-f0-9]{32}$/.test(data.visitorId) &&
      Number.isSafeInteger(data.issuedAt) &&
      data.issuedAt <= now &&
      now - data.issuedAt < 30 * DAY
      ? data.visitorId
      : null
  } catch {
    return null
  }
}
module.exports = {
  DAY,
  RETENTION_DAYS,
  payment,
  properties,
  attribution,
  readAttribution,
  failure
}
