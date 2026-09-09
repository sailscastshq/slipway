module.exports = {
  friendlyName: 'Resolve Wake readiness',
  description:
    'Internal readiness projection; callers must authorize the app before exposing it.',
  inputs: { appId: { type: 'string', required: true } },
  exits: { notFound: {} },
  fn: async function ({ appId }) {
    const app = await App.findOne({ id: appId })
    if (!app) throw 'notFound'
    if (!app.wakeEnabled) return { state: 'disabled' }
    if (!sails.wakeStorageReady) return { state: 'unavailable' }
    try {
      const result = await sails
        .getDatastore('analytics')
        .sendNativeQuery(
          'SELECT deployment, hook_version, protocol, last_seen_at FROM wake_connections WHERE app=?',
          [String(app.id)]
        )
      const connection = result.rows[0]
      if (!connection) return { state: 'waiting_for_runtime' }
      if (
        app.currentDeployment &&
        String(app.currentDeployment) !== connection.deployment
      )
        return { state: 'waiting_for_runtime' }
      if (Date.now() - connection.last_seen_at > 120000)
        return { state: 'unavailable' }
      return {
        state: 'foundation_only',
        hookVersion: connection.hook_version,
        protocol: connection.protocol
      }
    } catch {
      return { state: 'unavailable' }
    }
  }
}
