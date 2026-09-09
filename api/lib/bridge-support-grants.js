const crypto = require('node:crypto')
const transaction = require('./with-datastore-transaction')
const hash = (value) =>
  crypto.createHash('sha256').update(String(value)).digest('hex')
async function audit(grant, action, details = {}, db) {
  await AuditLog.create({
    action: `bridge.impersonation.${action}`,
    resourceType: 'app',
    resourceId: String(grant.app),
    user: grant.actor,
    team: grant.scope.team,
    details: { ...grant.scope, grantId: grant.id, ...details }
  }).usingConnection(db)
}
async function authenticate(req, appId) {
  const supplied =
    /^Bearer (\S+)$/.exec(String(req.headers.authorization || ''))?.[1] || ''
  const app = await App.findOne({ id: appId }).decrypt()
  if (
    !app?.bridgeEnabled ||
    !app.bridgeSecret ||
    !crypto.timingSafeEqual(
      Buffer.from(hash(supplied)),
      Buffer.from(hash(app.bridgeSecret))
    )
  )
    throw Error('Unauthorized')
  return app
}
async function expire(app) {
  for (const grant of await BridgeSupportGrant.find({
    app: app.id,
    status: { in: ['issued', 'active'] }
  })) {
    const actor = await User.forRequest({
      auth: { userId: grant.actor, teamId: grant.scope.team }
    })
    const actorRevoked =
      !actor ||
      !['owner', 'admin'].includes(actor.teamRole) ||
      (grant.scope.actorAuthVersion !== undefined &&
        grant.scope.actorAuthVersion !== (actor.authVersion || ''))
    const status =
      !app.bridgeEnabled ||
      actorRevoked ||
      grant.credentialHash !== hash(app.bridgeSecret)
        ? 'revoked'
        : (grant.status === 'issued' ? grant.expiresAt : grant.endsAt) <=
          Date.now()
        ? 'expired'
        : null
    if (!status) continue
    await transaction(async (db) => {
      const updated = await BridgeSupportGrant.updateOne({
        id: grant.id,
        status: grant.status
      })
        .set({ status })
        .usingConnection(db)
      if (updated) await audit(grant, status, {}, db)
    })
  }
}
async function revokeApp(appId) {
  await transaction(async (db) => {
    const grants = await BridgeSupportGrant.find({
      app: appId,
      status: { in: ['issued', 'active'] }
    }).usingConnection(db)
    for (const grant of grants) {
      await BridgeSupportGrant.updateOne({ id: grant.id })
        .set({ status: 'revoked' })
        .usingConnection(db)
      await audit(grant, 'revoked', {}, db)
    }
  })
}
module.exports = { hash, audit, authenticate, expire, revokeApp }
