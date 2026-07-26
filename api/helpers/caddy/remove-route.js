const { execFile } = require('child_process')
const { promisify } = require('node:util')

const execFileAsync = promisify(execFile)

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

    try {
      await execFileAsync(dockerPath, ['rm', '-f', routeContainerName])
      sails.log.info(`Caddy route container removed: ${routeContainerName}`)
      return { removed: true, routeId: routeContainerName }
    } catch (error) {
      if (/no such container/i.test(error.message || '')) {
        return { removed: false, routeId: routeContainerName }
      }
      throw error
    }
  }
}
