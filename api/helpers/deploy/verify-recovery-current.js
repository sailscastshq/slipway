const recovery = require('../../lib/deployment-recovery')
module.exports = {
  friendlyName: 'Verify recovery current',
  description:
    'Recheck a recorded immutable candidate before restart finalization retires its predecessor.',
  inputs: {
    app: { type: 'ref', required: true },
    deploymentId: { type: 'string', required: true }
  },
  exits: { success: {} },
  fn: async function ({ app, deploymentId }) {
    // Preserve legacy reconciliation behavior without inventing immutable history.
    if (!recovery.IMAGE_ID.test(app.imageId || '')) return
    try {
      await sails.helpers.docker.healthCheck.with({
        containerName: app.containerName,
        port: app.port || 1337,
        hostPort: app.hostPort,
        path: App.normalizeHealthPath(app.healthPath),
        timeout: sails.helpers.docker.resolveStartupWindow.with({
          resourceLimits: app.resourceLimits
        }),
        inspectContainer: true,
        deploymentId
      })
    } catch (error) {
      await sails.helpers.setting.set(
        recovery.HOLD_PREFIX + String(app.id),
        JSON.stringify({
          deploymentId,
          createdAt: Date.now(),
          reason:
            'The committed candidate failed restart readiness. Preserve both containers and inspect traffic ownership.'
        })
      )
      throw Object.assign(
        new Error(
          'The committed candidate failed restart readiness; operator recovery is required.'
        ),
        { code: 'TRAFFIC_RECOVERY_HEALTH_FAILED', cause: error }
      )
    }
  }
}
