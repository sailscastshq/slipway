module.exports = {
  friendlyName: 'Build Wake runtime configuration',
  inputs: {
    appId: { type: 'string', defaultsTo: '' },
    deploymentId: { type: 'string', required: true }
  },
  fn: async function ({ appId, deploymentId }) {
    // Always overwrite reserved variables, including disabled apps and rollback.
    const config = {
      SLIPWAY_WAKE_ENABLED: 'false',
      SLIPWAY_WAKE_SECRET: '',
      SLIPWAY_WAKE_APP_ID: '',
      SLIPWAY_WAKE_DEPLOYMENT_ID: '',
      SLIPWAY_WAKE_INGEST_URL: '',
      SLIPWAY_WAKE_ROUTE_PATH: '/'
    }
    if (!appId) return config
    const app = await App.findOne({ id: appId }).decrypt()
    if (!app?.wakeEnabled || !app.wakeSecret) return config
    const host =
      sails.config.environment === 'production'
        ? 'slipway'
        : 'host.docker.internal'
    return {
      SLIPWAY_WAKE_ENABLED: 'true',
      SLIPWAY_WAKE_SECRET: app.wakeSecret,
      SLIPWAY_WAKE_APP_ID: String(app.id),
      SLIPWAY_WAKE_DEPLOYMENT_ID: deploymentId,
      SLIPWAY_WAKE_INGEST_URL: `http://${host}:1337/api/v1/wake/ingest`,
      SLIPWAY_WAKE_ROUTE_PATH: app.routePath || '/'
    }
  }
}
