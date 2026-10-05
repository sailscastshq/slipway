module.exports = {
  friendlyName: 'Health check',

  description: 'Returns a 200 OK response for health check monitoring.',

  exits: {
    success: {
      description: 'Service is healthy.'
    }
  },

  fn: async function () {
    let upgrade
    if (process.env.SLIPWAY_UPGRADE_MARKER) {
      try {
        upgrade = require('../../lib/upgrade-startup').fromEnvironment(
          sails.config.datastores
        )
      } catch {
        return this.res
          .status(503)
          .json({ status: 'unavailable', code: 'upgradeNotReady' })
      }
    }
    return {
      status: 'ok',
      version: sails.config.slipway?.version || 'unknown',
      ...(upgrade ? { upgrade } : {})
    }
  }
}
