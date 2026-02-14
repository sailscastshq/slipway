const { execFile } = require('child_process')

module.exports = {
  friendlyName: 'Remove route',

  description: 'Remove a Caddy route container for an environment.',

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
    const dockerPath = sails.config.docker?.binaryPath || 'docker'
    const routeContainerName = `slipway-route-${projectSlug}-${environmentSlug}`

    return new Promise((resolve) => {
      execFile(dockerPath, ['rm', '-f', routeContainerName], (err) => {
        if (!err) {
          sails.log.info(`Caddy route container removed: ${routeContainerName}`)
        }
        resolve({ removed: true, routeId: routeContainerName })
      })
    })
  }
}
