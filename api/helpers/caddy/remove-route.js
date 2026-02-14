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
    const routeId = `slipway-${projectSlug}-${environmentSlug}`

    try {
      await sails.helpers.caddy.caddyRequest.with({
        method: 'DELETE',
        path: `/id/${routeId}`
      })

      sails.log.info(`Caddy route removed: ${routeId}`)
      return { removed: true, routeId }
    } catch (err) {
      sails.log.warn(`Caddy route removal failed for ${routeId}: ${err.message}`)
      throw 'notFound'
    }
  }
}
