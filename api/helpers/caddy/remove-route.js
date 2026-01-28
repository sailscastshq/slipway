const http = require('http')

module.exports = {
  friendlyName: 'Remove route',

  description: 'Remove a route from Caddy via its admin API.',

  inputs: {
    projectSlug: {
      type: 'string',
      required: true,
      description: 'Project slug'
    },
    environmentSlug: {
      type: 'string',
      required: true,
      description: 'Environment slug'
    }
  },

  exits: {
    success: {
      description: 'Route removed successfully'
    },
    notFound: {
      description: 'Route not found (already removed)'
    },
    caddyError: {
      description: 'Failed to remove Caddy route'
    }
  },

  fn: async function ({ projectSlug, environmentSlug }) {
    const caddyAdminUrl = sails.config.custom.caddyAdminUrl || 'http://localhost:2019'
    const routeId = `slipway-${projectSlug}-${environmentSlug}`

    return new Promise((resolve, reject) => {
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
            sails.log.info(`Caddy route removed: ${routeId}`)
            resolve({ removed: true, routeId })
          } else if (res.statusCode === 404) {
            sails.log.verbose(`Caddy route not found: ${routeId}`)
            throw 'notFound'
          } else {
            sails.log.error(`Caddy API error: ${res.statusCode}`)
            reject(new Error(`Caddy API error: ${res.statusCode}`))
          }
        }
      )

      req.on('error', (error) => {
        sails.log.error(`Caddy request error: ${error.message}`)
        reject(error)
      })

      req.end()
    })
  }
}
