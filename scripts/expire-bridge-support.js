const grants = require('../api/lib/bridge-support-grants')
module.exports = {
  friendlyName: 'Expire Bridge support grants',
  description:
    'Expire unused and abandoned support grants and audit revoked access.',
  quest: { interval: '1 minute', withoutOverlapping: true },
  fn: async function () {
    const pending = await BridgeSupportGrant.find({
      status: { in: ['issued', 'active'] }
    }).select(['app'])
    for (const id of new Set(pending.map((grant) => grant.app))) {
      const app = await App.findOne({ id }).decrypt()
      if (app) await grants.expire(app)
      else await grants.revokeApp(id)
    }
  }
}
