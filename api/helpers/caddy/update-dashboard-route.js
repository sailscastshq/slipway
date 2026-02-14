const http = require('http')

module.exports = {
  friendlyName: 'Update dashboard route',

  description: 'Create or update a Caddy route for the Slipway dashboard domain.',

  inputs: {
    domain: {
      type: 'string',
      required: true,
      description: 'The dashboard domain (e.g. slipway.example.com)'
    }
  },

  exits: {
    success: {
      description: 'Dashboard route updated successfully'
    },
    caddyError: {
      description: 'Failed to update Caddy config'
    }
  },

  fn: async function ({ domain }) {
    const caddyAdminUrl = sails.config.custom.caddyAdminUrl || 'http://localhost:2019'
    const routeId = 'slipway-dashboard'
    const port = sails.config.port || 1337

    const route = {
      '@id': routeId,
      match: [{ host: [domain] }],
      handle: [
        {
          handler: 'reverse_proxy',
          upstreams: [{ dial: `host.docker.internal:${port}` }]
        }
      ],
      terminal: true
    }

    const routeData = JSON.stringify(route)

    return new Promise((resolve, reject) => {
      const createRoute = () => {
        const url = new URL(`${caddyAdminUrl}/config/apps/http/servers/srv0/routes`)

        const req = http.request(
          {
            hostname: url.hostname,
            port: url.port,
            path: url.pathname,
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'Content-Length': Buffer.byteLength(routeData)
            }
          },
          (res) => {
            let body = ''
            res.on('data', (chunk) => { body += chunk })
            res.on('end', () => {
              if (res.statusCode >= 200 && res.statusCode < 300) {
                sails.log.info(`Caddy dashboard route created for ${domain}`)
                resolve({ domain, routeId, action: 'created' })
              } else {
                sails.log.error(`Caddy API error: ${res.statusCode} - ${body}`)
                reject(new Error(`Caddy API error: ${res.statusCode}`))
              }
            })
          }
        )

        req.on('error', (error) => {
          sails.log.error(`Caddy request error: ${error.message}`)
          reject(error)
        })

        req.write(routeData)
        req.end()
      }

      // Delete existing route first (ignore errors if not found)
      const deleteUrl = new URL(`${caddyAdminUrl}/id/${routeId}`)

      const deleteReq = http.request(
        {
          hostname: deleteUrl.hostname,
          port: deleteUrl.port,
          path: deleteUrl.pathname,
          method: 'DELETE'
        },
        () => { createRoute() }
      )

      deleteReq.on('error', () => { createRoute() })
      deleteReq.end()
    })
  }
}
