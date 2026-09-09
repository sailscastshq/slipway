const grants = require('../../lib/bridge-support-grants')
module.exports = {
  friendlyName: 'Revoke Bridge support view',
  inputs: { grantId: { type: 'string', required: true } },
  exits: { success: { statusCode: 200 }, forbidden: { statusCode: 403 } },
  fn: async function ({ grantId }) {
    const user = await User.forRequest(this.req)
    const grant = await BridgeSupportGrant.findOne({ id: grantId })
    if (
      !user ||
      !grant ||
      !['owner', 'admin'].includes(user.teamRole) ||
      Number(grant.scope.team) !== Number(user.team)
    )
      throw 'forbidden'
    await require('../../lib/with-datastore-transaction')(async (db) => {
      const changed = await BridgeSupportGrant.updateOne({
        id: grant.id,
        status: { in: ['issued', 'active'] }
      })
        .set({ status: 'revoked' })
        .usingConnection(db)
      if (changed)
        await grants.audit(grant, 'revoked', { revokedBy: String(user.id) }, db)
    })
    return { revoked: true }
  }
}
