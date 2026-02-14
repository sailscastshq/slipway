const http = require('http')

module.exports = {
  friendlyName: 'Update route',

  description: 'Update or create a route in Caddy via its admin API.',

  inputs: {
    environmentId: {
      type: 'string',
      required: true,
      description: 'Environment ID to update route for'
    }
  },

  exits: {
    success: {
      description: 'Route updated successfully'
    },
    noApp: {
      description: 'No app deployed in this environment'
    },
    caddyError: {
      description: 'Failed to update Caddy config'
    }
  },

  fn: async function ({ environmentId }) {
    // Generate the route config
    const config = await sails.helpers.caddy.generateRouteConfig(environmentId)

    if (!config) {
      throw 'noApp'
    }

    const caddyAdminUrl = sails.config.custom.caddyAdminUrl || 'http://localhost:2019'
    const routeId = config.route['@id']

    // Try to update existing route first, create if it doesn't exist
    return new Promise((resolve, reject) => {
      const routeData = JSON.stringify(config.route)

      // First, try to delete existing route (if any), then create new one
      const createRoute = () => {
        const url = new URL(`${caddyAdminUrl}/config/apps/http/servers/srv0/routes`)

        const options = {
          hostname: url.hostname,
          port: url.port,
          path: url.pathname,
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Content-Length': Buffer.byteLength(routeData)
          }
        }

        const req = http.request(options, (res) => {
          let body = ''
          res.on('data', (chunk) => {
            body += chunk
          })
          res.on('end', () => {
            if (res.statusCode >= 200 && res.statusCode < 300) {
              sails.log.info(`Caddy route created for ${config.domain}`)
              resolve({
                domain: config.domain,
                routeId,
                action: 'created'
              })
            } else {
              sails.log.error(`Caddy API error: ${res.statusCode} - ${body}`)
              reject(new Error(`Caddy API error: ${res.statusCode}`))
            }
          })
        })

        req.on('error', (error) => {
          sails.log.error(`Caddy request error: ${error.message}`)
          reject(error)
        })

        req.write(routeData)
        req.end()
      }

      // Try to delete first (will fail if route doesn't exist, which is fine)
      const deleteUrl = new URL(`${caddyAdminUrl}/id/${routeId}`)

      const deleteReq = http.request(
        {
          hostname: deleteUrl.hostname,
          port: deleteUrl.port,
          path: deleteUrl.pathname,
          method: 'DELETE'
        },
        () => {
          // Whether delete succeeded or not, create the new route
          createRoute()
        }
      )

      deleteReq.on('error', () => {
        // Ignore delete errors and proceed to create
        createRoute()
      })

      deleteReq.end()
    })
  }
}
