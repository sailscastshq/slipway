const { budget } = require('../../../../lib/wake-ingest')
module.exports = {
  friendlyName: 'Commit Wake revenue receipt',
  inputs: {
    appId: { type: 'string', required: true },
    deploymentId: { type: 'string', required: true },
    payment: { type: 'ref', required: true }
  },
  exits: {
    unauthorized: { statusCode: 401 },
    badRequest: { statusCode: 400 },
    conflict: { statusCode: 409 },
    rateLimited: { statusCode: 429 },
    unavailable: { statusCode: 503 }
  },
  fn: async function ({ appId, deploymentId, payment }) {
    let scope
    try {
      scope = await sails.helpers.wake.authenticate.with({
        req: this.req,
        appId,
        deploymentId
      })
    } catch (error) {
      throw error.code === 'unauthorized' ? 'unauthorized' : 'unavailable'
    }
    this.res.set('Cache-Control', 'no-store')
    if (
      Object.keys(this.req.body || {}).some(
        (key) => !['appId', 'deploymentId', 'payment'].includes(key)
      )
    )
      throw 'badRequest'
    try {
      if (!sails.wakeStorageReady) throw 'unavailable'
      if (
        !(await budget(
          sails.getDatastore('analytics'),
          scope.app,
          1,
          Buffer.byteLength(JSON.stringify(this.req.body))
        ))
      )
        throw 'rateLimited'
      const app = await App.findOne({ id: appId }).decrypt()
      const result = require('../../../../lib/wake-store').revenue(
        scope,
        payment,
        app
      )
      sails.wakeLastStorageFailure = 0
      return result
    } catch (error) {
      if (['rateLimited', 'unavailable'].includes(error)) throw error
      if (error.code === 'conflict') throw 'conflict'
      if (/^(invalid_|unknown_transaction)/.test(error.code || ''))
        throw 'badRequest'
      sails.wakeLastStorageFailure = Date.now()
      throw 'unavailable'
    }
  }
}
