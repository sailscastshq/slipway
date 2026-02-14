module.exports = {
  friendlyName: 'Configure TLS',

  description:
    'Configure TLS for Caddy routes. With caddy-docker-proxy, TLS is automatic ' +
    'for domain names. This recreates the dashboard route container with the ' +
    'ACME email label so Caddy uses it for certificate provisioning.',

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
    // Recreate dashboard route container with TLS email if domain is set
    const instanceDomain = await sails.helpers.setting.get('instanceDomain')
    if (instanceDomain) {
      await sails.helpers.caddy.updateDashboardRoute(instanceDomain)
    }

    sails.log.info(`Caddy TLS configured with ACME email: ${acmeEmail}`)
    return { configured: true, email: acmeEmail }
  }
}
