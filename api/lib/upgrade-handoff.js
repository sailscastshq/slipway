const crypto = require('node:crypto')
const Database = require('better-sqlite3')
const ledger = require('./upgrade-ledger')
function fail() {
  throw Object.assign(
    new Error(
      'The instance administrator upgrade handoff is invalid or expired.'
    ),
    { code: 'upgradeHandoffRejected' }
  )
}
function signature(secret, claims) {
  if (typeof secret !== 'string' || secret.length < 32) fail()
  return crypto
    .createHmac('sha256', secret)
    .update('slipway-upgrade-handoff-v1\n')
    .update(ledger.digest(claims))
    .digest('hex')
}
function sign({
  secret,
  actorUserId,
  authVersion,
  instanceId,
  reviewHash,
  now = Date.now()
}) {
  if (
    !Number.isSafeInteger(actorUserId) ||
    actorUserId <= 0 ||
    typeof authVersion !== 'string' ||
    !instanceId ||
    !/^[a-f0-9]{64}$/.test(reviewHash || '')
  )
    fail()
  const claims = {
    format: 1,
    actorUserId,
    authVersion,
    instanceId,
    reviewHash,
    nonce: crypto.randomUUID(),
    issuedAt: now,
    expiresAt: now + 120000
  }
  return { claims, signature: signature(secret, claims) }
}
function verify({
  grant,
  secret,
  instanceId,
  reviewHash,
  database,
  consumedNonces,
  now = Date.now()
}) {
  const claims = grant?.claims
  if (
    !claims ||
    claims.format !== 1 ||
    claims.instanceId !== instanceId ||
    claims.reviewHash !== reviewHash ||
    !Number.isSafeInteger(claims.issuedAt) ||
    !Number.isSafeInteger(claims.expiresAt) ||
    claims.issuedAt > now + 5000 ||
    claims.expiresAt <= now ||
    claims.expiresAt - claims.issuedAt !== 120000 ||
    !/^[a-f0-9-]{36}$/.test(claims.nonce || '') ||
    !Number.isSafeInteger(claims.actorUserId) ||
    claims.actorUserId <= 0 ||
    typeof claims.authVersion !== 'string' ||
    !/^[a-f0-9]{64}$/.test(grant.signature || '')
  )
    fail()
  if (
    !crypto.timingSafeEqual(
      Buffer.from(grant.signature, 'hex'),
      Buffer.from(signature(secret, claims), 'hex')
    ) ||
    !Array.isArray(consumedNonces) ||
    consumedNonces.includes(claims.nonce)
  )
    fail()
  const db = new Database(database, { readonly: true, fileMustExist: true })
  try {
    const actor = db
      .prepare(
        'SELECT id, auth_version, is_genesis_user FROM users WHERE id = ?'
      )
      .get(claims.actorUserId)
    if (
      !actor ||
      ![1, '1', '1.0', 'true'].includes(actor.is_genesis_user) ||
      actor.auth_version !== claims.authVersion
    )
      fail()
  } catch {
    fail()
  } finally {
    db.close()
  }
  return {
    actorUserId: claims.actorUserId,
    nonce: claims.nonce,
    instanceId,
    reviewHash
  }
}
module.exports = { sign, verify }
