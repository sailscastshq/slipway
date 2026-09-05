const { execFile } = require('child_process')

module.exports = {
  friendlyName: 'Remove dashboard route',

  description:
    'Remove the Caddy route container for the Slipway dashboard domain.',

  inputs: {},

  exits: {
    success: {
      description: 'Dashboard route removed successfully'
    }
  },

  fn: async function () {
    const dockerPath = sails.config.docker?.binaryPath || 'docker'

    return new Promise((resolve, reject) => {
      execFile(dockerPath, ['rm', '-f', 'slipway-route-dashboard'], (err) => {
        if (err && !/no such (object|container)/i.test(err.message || '')) {
          reject(err)
          return
        }
        if (!err) {
          sails.log.info('Caddy dashboard route container removed')
        }
        resolve()
      })
    })
  }
}
