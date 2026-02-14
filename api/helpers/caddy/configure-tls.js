const http = require('http')

module.exports = {
  friendlyName: 'Configure TLS',

  description: 'Configure Caddy ACME automation for automatic TLS certificates.',

  inputs: {
    acmeEmail: {
      type: 'string',
      required: true,
      description: 'Email address for Let\'s Encrypt ACME registration'
    }
  },

  exits: {
    success: {
      description: 'TLS configured successfully'
    },
    caddyError: {
      description: 'Failed to configure TLS'
    }
  },

  fn: async function ({ acmeEmail }) {
    const caddyAdminUrl = sails.config.custom.caddyAdminUrl || 'http://localhost:2019'

    // Configure ACME automation policy via Caddy admin API
    // This tells Caddy to automatically provision Let's Encrypt certs
    // for any domain with a valid DNS record
    const tlsConfig = {
      automation: {
        policies: [
          {
            issuers: [
              {
                module: 'acme',
                email: acmeEmail
              }
            ]
          }
        ]
      }
    }

    return new Promise((resolve, reject) => {
      const data = JSON.stringify(tlsConfig)
      const url = new URL(`${caddyAdminUrl}/config/apps/tls`)

      const options = {
        hostname: url.hostname,
        port: url.port,
        path: url.pathname,
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(data)
        }
      }

      const req = http.request(options, (res) => {
        let body = ''
        res.on('data', (chunk) => { body += chunk })
        res.on('end', () => {
          if (res.statusCode >= 200 && res.statusCode < 300) {
            sails.log.info(`Caddy TLS configured with ACME email: ${acmeEmail}`)
            resolve({ configured: true, email: acmeEmail })
          } else {
            sails.log.error(`Caddy TLS config error: ${res.statusCode} - ${body}`)
            reject(new Error(`Caddy TLS config error: ${res.statusCode}`))
          }
        })
      })

      req.on('error', (error) => {
        sails.log.error(`Caddy TLS request error: ${error.message}`)
        reject(error)
      })

      req.write(data)
      req.end()
    })
  }
}
