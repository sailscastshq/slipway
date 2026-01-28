const http = require('http')

module.exports = {
  friendlyName: 'Get routes',

  description: 'Get all Slipway routes from Caddy.',

  inputs: {},

  exits: {
    success: {
      description: 'Routes retrieved',
      outputType: 'ref'
    },
    caddyError: {
      description: 'Failed to get Caddy config'
    }
  },

  fn: async function () {
    const caddyAdminUrl = sails.config.custom.caddyAdminUrl || 'http://localhost:2019'

    return new Promise((resolve, reject) => {
      const url = new URL(`${caddyAdminUrl}/config/apps/http/servers/srv0/routes`)

      http
        .get(url, (res) => {
          let body = ''
          res.on('data', (chunk) => {
            body += chunk
          })
          res.on('end', () => {
            if (res.statusCode === 200) {
              try {
                const routes = JSON.parse(body)
                // Filter to only Slipway routes
                const slipwayRoutes = (routes || []).filter(
                  (route) => route['@id'] && route['@id'].startsWith('slipway-')
                )
                resolve(slipwayRoutes)
              } catch (error) {
                reject(new Error('Failed to parse Caddy response'))
              }
            } else if (res.statusCode === 404) {
              // No routes configured yet
              resolve([])
            } else {
              reject(new Error(`Caddy API error: ${res.statusCode}`))
            }
          })
        })
        .on('error', (error) => {
          sails.log.error(`Caddy request error: ${error.message}`)
          reject(error)
        })
    })
  }
}
