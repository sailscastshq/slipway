const { LIMITS, normalize, budget } = require('../../../../lib/wake-ingest')
module.exports = {
  friendlyName: 'Ingest Wake events',
  inputs: {
    appId: { type: 'string', required: true },
    deploymentId: { type: 'string', required: true },
    events: { type: 'ref', required: true }
  },
  exits: {
    unauthorized: { statusCode: 401 },
    badRequest: { statusCode: 400 },
    rateLimited: { statusCode: 429 },
    unavailable: { statusCode: 503 }
  },
  fn: async function ({ appId, deploymentId, events }) {
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
    if (!sails.wakeStorageReady) throw 'unavailable'
    const bytes = Buffer.byteLength(JSON.stringify(this.req.body || {}))
    let normalized
    try {
      if (
        bytes > LIMITS.bytes ||
        Object.keys(this.req.body || {}).some(
          (key) => !['appId', 'deploymentId', 'events'].includes(key)
        )
      )
        throw new Error('payload')
      normalized = normalize(events)
      const app = await App.findOne({ id: appId })
      const contract = require('../../../../../packages/hook/lib/wake-contract')
      const settings = contract.settings(app.wakeSettings)
      normalized = normalized.filter(
        (event) =>
          !contract.excluded(
            event.path,
            settings,
            app.routePath === '/' ? '' : app.routePath || ''
          )
      )
      if (app.wakeSettings?.mode === 'cookieless') {
        normalized = normalized.map((event) => ({
          ...event,
          visitorId: null,
          sessionId: null,
          hostUserId: null
        }))
      }
    } catch {
      throw 'badRequest'
    }
    if (!normalized.length) return { accepted: 0, duplicates: 0 }
    try {
      const db = sails.getDatastore('analytics')
      if (!(await budget(db, scope.app, normalized.length, bytes)))
        throw 'rateLimited'
      const now = Date.now()
      const values = normalized.flatMap((event) => [
        scope.app,
        scope.environment,
        scope.deployment,
        event.id,
        event.kind,
        event.name,
        event.occurredAt,
        now,
        event.path,
        event.visitorId,
        event.sessionId,
        event.hostUserId,
        JSON.stringify(event.dimensions),
        event.provenance
      ])
      const result = await db.sendNativeQuery(
        `INSERT INTO wake_events
        (app, environment, deployment, event_id, kind, name, occurred_at, received_at, path, visitor_id, session_id, host_user_id, dimensions, provenance)
        VALUES ${normalized
          .map(() => '(?,?,?,?,?,?,?,?,?,?,?,?,?,?)')
          .join(',')}
        ON CONFLICT(app, event_id) DO NOTHING`,
        values
      )
      return {
        accepted: result.changes,
        duplicates: normalized.length - result.changes
      }
    } catch (error) {
      if (error === 'rateLimited') throw error
      throw 'unavailable'
    }
  }
}
