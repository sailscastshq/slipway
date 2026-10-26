const { createUpdater } = require('../../../bin/slipway-updater.cjs')
module.exports = {
  friendlyName: 'Get update status',
  inputs: {},
  exits: { success: { outputType: 'ref' } },
  fn: async function () {
    return createUpdater({
      binary: sails.config.docker?.binaryPath || 'docker'
    }).status()
  }
}
