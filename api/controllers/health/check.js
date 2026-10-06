module.exports = {
  friendlyName: 'Health check',

  description: 'Returns a 200 OK response for health check monitoring.',

  exits: {
    success: {
      description: 'Service is healthy.'
    }
  },

  fn: async function () {
    const ready = require('../../lib/release-schema-ready')(sails)
    const migration = ready ? require('../../lib/release-migrations') : null
    return {
      ...(ready
        ? {
            releaseMigrations: {
              ready: true,
              version: '0.0.88',
              checksum: migration.checksum
            }
          }
        : {}),
      status: 'ok',
      version: sails.config.slipway?.version || 'unknown'
    }
  }
}
