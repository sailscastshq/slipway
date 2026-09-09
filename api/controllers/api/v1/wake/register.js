const { budget } = require('../../../../lib/wake-ingest')
module.exports = {
  friendlyName: 'Register Wake runtime',
  inputs: {
    appId: { type: 'string', required: true },
    deploymentId: { type: 'string', required: true },
    hookVersion: { type: 'string', required: true },
    protocol: { type: 'number', required: true }
  },
  exits: {
    unauthorized: { statusCode: 401 },
    badRequest: { statusCode: 400 },
    rateLimited: { statusCode: 429 },
    unavailable: { statusCode: 503 }
  },
  fn: async function ({ appId, deploymentId, hookVersion, protocol }) {
    let scope
    try {
      scope = await sails.helpers.wake.authenticate.with({
        req: this.req,
        appId,
        deploymentId
      })
    } catch (error) {
      if (error.code === 'unauthorized') throw 'unauthorized'
      throw 'unavailable'
    }
    if (
      !/^\d+\.\d+\.\d+(?:-[a-zA-Z0-9.-]+)?$/.test(hookVersion) ||
      hookVersion.length > 64 ||
      protocol !== 1
    )
      throw 'badRequest'
    if (!sails.wakeStorageReady) throw 'unavailable'
    try {
      const db = sails.getDatastore('analytics')
      if (!(await budget(db, scope.app, 0, 256))) throw 'rateLimited'
      await db.sendNativeQuery(
        `INSERT INTO wake_connections
        (app, environment, deployment, hook_version, protocol, collection_ready, last_seen_at)
        VALUES (?,?,?,?,?,0,?) ON CONFLICT(app) DO UPDATE SET
        environment=excluded.environment, deployment=excluded.deployment,
        hook_version=excluded.hook_version, protocol=excluded.protocol,
        collection_ready=0, last_seen_at=excluded.last_seen_at`,
        [
          scope.app,
          scope.environment,
          scope.deployment,
          hookVersion,
          protocol,
          Date.now()
        ]
      )
      // Foundation transport is available, but automatic collection is not released.
      return { protocol: 1, collectionReady: false, leaseMs: 0 }
    } catch (error) {
      if (error === 'rateLimited') throw error
      throw 'unavailable'
    }
  }
}
