const { execFile } = require('child_process')

module.exports = {
  friendlyName: 'Remove dashboard route',

  description: 'Remove the Caddy route container for the Slipway dashboard domain.',

  inputs: {},

  exits: {
    success: {
      description: 'Dashboard route removed successfully'
    }
  },

  fn: async function () {
    const dockerPath = sails.config.docker?.binaryPath || 'docker'

    return new Promise((resolve) => {
      execFile(dockerPath, ['rm', '-f', 'slipway-route-dashboard'], (err) => {
        if (!err) {
          sails.log.info('Caddy dashboard route container removed')
        }
        resolve()
      })
    })
  }
}
