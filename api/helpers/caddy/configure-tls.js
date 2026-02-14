module.exports = {
  friendlyName: 'Configure TLS',

  description: 'Configure Caddy ACME automation for automatic TLS certificates.',

  inputs: {
    acmeEmail: {
      type: 'string',
      required: true,
      description: "Email address for Let's Encrypt ACME registration"
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

    try {
      await sails.helpers.caddy.caddyRequest.with({
        method: 'POST',
        path: '/config/apps/tls',
        data: tlsConfig
      })

      sails.log.info(`Caddy TLS configured with ACME email: ${acmeEmail}`)
      return { configured: true, email: acmeEmail }
    } catch (err) {
      sails.log.error(`Caddy TLS config failed: ${err.message}`)
      throw 'caddyError'
    }
  }
}
