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
      ![1, 2].includes(protocol)
    )
      throw 'badRequest'
    if (!sails.wakeStorageReady) throw 'unavailable'
    try {
      const db = sails.getDatastore('analytics')
      if (!(await budget(db, scope.app, 0, 256))) throw 'rateLimited'
      const app = await App.findOne({ id: appId })
      const { domains } = await Environment.resolveDomains(app.environment)
      const settings =
        require('../../../../../packages/hook/lib/wake-contract').settings({
          ...app.wakeSettings,
          allowedOrigins: [
            ...domains.map((domain) => `https://${domain}`),
            ...(app.wakeSettings?.allowedOrigins || [])
          ]
        })
      const ready = protocol === 2 && settings.allowedOrigins.length > 0
      await db.sendNativeQuery(
        `INSERT INTO wake_connections
        (app, environment, deployment, hook_version, protocol, collection_ready, last_seen_at)
        VALUES (?,?,?,?,?,?,?) ON CONFLICT(app) DO UPDATE SET
        environment=excluded.environment, deployment=excluded.deployment,
        hook_version=excluded.hook_version, protocol=excluded.protocol,
        collection_ready=excluded.collection_ready, last_seen_at=excluded.last_seen_at`,
        [
          scope.app,
          scope.environment,
          scope.deployment,
          hookVersion,
          protocol,
          ready ? 1 : 0,
          Date.now()
        ]
      )
      return protocol === 1
        ? { protocol: 1, collectionReady: false, leaseMs: 0 }
        : {
            protocol: 2,
            collectionReady: ready,
            leaseMs: ready ? 120000 : 0,
            settings
          }
    } catch (error) {
      if (error === 'rateLimited') throw error
      throw 'unavailable'
    }
  }
}
