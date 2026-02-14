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

    // Delete existing route first (ignore errors — route may not exist yet)
    try {
      await sails.helpers.caddy.caddyRequest.with({
        method: 'DELETE',
        path: `/id/${routeId}`
      })
    } catch (err) {
      sails.log.verbose(`Caddy dashboard delete (pre-create) skipped: ${err.message}`)
    }

    // Create the new route
    try {
      await sails.helpers.caddy.caddyRequest.with({
        method: 'POST',
        path: '/config/apps/http/servers/srv0/routes',
        data: route
      })

      sails.log.info(`Caddy dashboard route created for ${domain}`)
      return { domain, routeId, action: 'created' }
    } catch (err) {
      sails.log.error(`Caddy dashboard route creation failed: ${err.message}`)
      throw 'caddyError'
    }
  }
}
