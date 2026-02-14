const http = require('http')

module.exports = {
  friendlyName: 'Remove dashboard route',

  description: 'Remove the Caddy route for the Slipway dashboard domain.',

  inputs: {},

  exits: {
    success: {
      description: 'Dashboard route removed successfully'
    }
  },

  fn: async function () {
    const caddyAdminUrl = sails.config.custom.caddyAdminUrl || 'http://localhost:2019'
    const routeId = 'slipway-dashboard'

    return new Promise((resolve) => {
      const url = new URL(`${caddyAdminUrl}/id/${routeId}`)

      const req = http.request(
        {
          hostname: url.hostname,
          port: url.port,
          path: url.pathname,
          method: 'DELETE'
        },
        (res) => {
          if (res.statusCode === 200) {
            sails.log.info('Caddy dashboard route removed')
          }
          resolve()
        }
      )

      req.on('error', () => { resolve() })
      req.end()
    })
  }
}
