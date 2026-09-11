const crypto = require('node:crypto')

// Canonical hashes keep object key order and presentation-only actor data out of
// the binding. Tokens contain no record values and have no independent timer.
function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical)
  if (value && typeof value === 'object')
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .filter((key) => value[key] !== undefined)
        .map((key) => [key, canonical(value[key])])
    )
  return value
}
function hash(value) {
  return crypto
    .createHash('sha256')
    .update(JSON.stringify(canonical(value)))
    .digest('hex')
}
function signature(value, secret) {
  return crypto.createHmac('sha256', secret).update(value).digest('hex')
}
function same(left, right) {
  return (
    typeof left === 'string' &&
    Buffer.byteLength(left) === Buffer.byteLength(right) &&
    crypto.timingSafeEqual(Buffer.from(left), Buffer.from(right))
  )
}
function create(binding, action, state, secret) {
  const body = ['v2', hash(binding), hash(action), hash(state)].join('.')
  return `${body}.${signature(body, secret)}`
}
function read(token, secret) {
  if (typeof token !== 'string' || !/^v2(?:\.[a-f0-9]{64}){4}$/.test(token))
    return null
  const parts = token.split('.')
  if (!same(parts[4], signature(parts.slice(0, 4).join('.'), secret)))
    return null
  return { binding: parts[1], action: parts[2], state: parts[3] }
}
function bindingFor({ containerName, resource, recordId, actor }) {
  return {
    containerName,
    resource: resource.identity,
    recordId,
    actor: Object.fromEntries(
      ['id', 'source', 'teamId', 'projectId', 'environmentId', 'appId']
        .filter((key) => actor[key] !== undefined)
        .map((key) => [key, String(actor[key])])
    )
  }
}
module.exports = { create, read, hash, bindingFor }
