const { execFile } = require('child_process')

module.exports = {
  friendlyName: 'Get routes',

  description:
    'Get all Slipway route containers managed by caddy-docker-proxy.',

  inputs: {},

  exits: {
    success: {
      description: 'Routes retrieved',
      outputType: 'ref'
    },
    caddyError: {
      description: 'Failed to get routes'
    }
  },

  fn: async function () {
    const dockerPath = sails.config.docker?.binaryPath || 'docker'

    return new Promise((resolve) => {
      execFile(
        dockerPath,
        ['ps', '--filter', 'name=slipway-route-', '--format', '{{.Names}}'],
        (err, stdout) => {
          if (err) {
            sails.log.error(`Failed to list route containers: ${err.message}`)
            return resolve([])
          }

          const routes = stdout
            .trim()
            .split('\n')
            .filter(Boolean)
            .map((name) => ({
              '@id': name,
              containerName: name
            }))

          resolve(routes)
        }
      )
    })
  }
}
