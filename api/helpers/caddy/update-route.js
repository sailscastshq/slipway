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
    const config = await sails.helpers.caddy.generateRouteConfig(environmentId)

    if (!config) {
      throw 'noApp'
    }

    const routeId = config.route['@id']

    // Delete existing route first (ignore errors — route may not exist yet)
    try {
      await sails.helpers.caddy.caddyRequest.with({
        method: 'DELETE',
        path: `/id/${routeId}`
      })
    } catch (err) {
      sails.log.verbose(`Caddy route delete (pre-create) skipped: ${err.message}`)
    }

    // Create the new route
    try {
      await sails.helpers.caddy.caddyRequest.with({
        method: 'POST',
        path: '/config/apps/http/servers/srv0/routes',
        data: config.route
      })

      sails.log.info(`Caddy route created for ${config.domain}`)

      return {
        domain: config.domain,
        routeId,
        action: 'created'
      }
    } catch (err) {
      sails.log.error(`Caddy route creation failed: ${err.message}`)
      throw 'caddyError'
    }
  }
}
