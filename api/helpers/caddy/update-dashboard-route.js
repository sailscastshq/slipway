const { execFile } = require('child_process')

module.exports = {
  friendlyName: 'Update dashboard route',

  description:
    'Create or update a Caddy route for the Slipway dashboard domain ' +
    'using Docker labels picked up by caddy-docker-proxy.',

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
    const dockerPath = sails.config.docker?.binaryPath || 'docker'
    const network = sails.config.custom.slipwayNetwork || 'slipway'
    const containerName = 'slipway-route-dashboard'
    const port = sails.config.port || 1337

    // Remove existing route container
    await new Promise((resolve) => {
      execFile(dockerPath, ['rm', '-f', containerName], () => resolve())
    })

    // Build docker run args with caddy labels
    const args = [
      'run', '-d',
      '--name', containerName,
      '--network', network,
      '--restart', 'unless-stopped',
      '--label', `caddy=${domain}`,
      '--label', `caddy.reverse_proxy=slipway:${port}`
    ]

    // Add TLS email if configured
    const acmeEmail = await sails.helpers.setting.get('acmeEmail')
    if (acmeEmail) {
      args.push('--label', `caddy.tls=${acmeEmail}`)
    }

    args.push('alpine', 'sleep', 'infinity')

    return new Promise((resolve, reject) => {
      execFile(dockerPath, args, (err) => {
        if (err) {
          sails.log.error(`Dashboard route container creation failed: ${err.message}`)
          throw 'caddyError'
        }
        sails.log.info(`Caddy dashboard route created for ${domain}`)
        resolve({ domain, action: 'created' })
      })
    })
  }
}
