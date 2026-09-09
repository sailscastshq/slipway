const crypto = require('node:crypto')
module.exports = {
  friendlyName: 'Authenticate Wake runtime',
  inputs: {
    req: { type: 'ref', required: true },
    appId: { type: 'string', required: true },
    deploymentId: { type: 'string', required: true }
  },
  exits: { unauthorized: {} },
  fn: async function ({ req, appId, deploymentId }) {
    const token =
      /^Bearer (swk_[a-f0-9]{64})$/.exec(
        String(req.headers?.authorization || '')
      )?.[1] || ''
    if (
      !/^swk_[a-f0-9]{64}$/.test(token) ||
      !/^\d{1,20}$/.test(appId) ||
      !/^\d{1,20}$/.test(deploymentId)
    )
      throw 'unauthorized'
    const app = await App.findOne({ id: appId }).decrypt()
    if (!app?.wakeEnabled || !app.wakeSecret) throw 'unauthorized'
    const expected = Buffer.from(app.wakeSecret)
    const supplied = Buffer.from(token)
    if (
      expected.length !== supplied.length ||
      !crypto.timingSafeEqual(expected, supplied)
    )
      throw 'unauthorized'
    const deployment = await Deployment.findOne({
      id: deploymentId,
      app: app.id,
      environment: app.environment
    })
    if (!deployment) throw 'unauthorized'
    return {
      app: String(app.id),
      environment: String(app.environment),
      deployment: String(deployment.id)
    }
  }
}
