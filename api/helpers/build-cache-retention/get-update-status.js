const { createUpdater } = require('../../../bin/slipway-updater.cjs')
module.exports = {
  friendlyName: 'Read host update maintenance ownership',
  exits: { success: { outputType: 'ref' } },
  fn: async function () {
    return createUpdater({
      binary: sails.config.docker?.binaryPath || 'docker'
    }).maintenanceStatus()
  }
}
