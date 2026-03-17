const { execFile } = require('child_process')

module.exports = {
  friendlyName: 'Update route',

  description:
    'Update or create a Caddy route for an environment ' +
    'using a Docker label container picked up by caddy-docker-proxy.',

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

    const dockerPath = sails.config.docker?.binaryPath || 'docker'
    const network = sails.config.custom.slipwayNetwork || 'slipway'
    const routeContainerName = `slipway-route-${config.projectSlug}-${config.environmentSlug}`

    // Remove existing route container
    await new Promise((resolve) => {
      execFile(dockerPath, ['rm', '-f', routeContainerName], () => resolve())
    })

    if (!config.domains || config.domains.length === 0 || !config.route) {
      sails.log.info(
        `No hostname route configured for environment ${environmentId}; direct IP access remains available`
      )
      return {
        domains: [],
        routeId: routeContainerName,
        action: 'removed'
      }
    }

    // Get routable apps for this environment
    const apps = await App.find({ environment: environmentId })
    const routableApps = apps.filter(
      (app) => app.hostPort && app.routePath !== null
    )

    // Build docker run args with caddy labels
    const args = [
      'run',
      '-d',
      '--name',
      routeContainerName,
      '--network',
      network,
      '--restart',
      'unless-stopped',
      '--label',
      `caddy=${config.domains.join(',')}`
    ]

    if (routableApps.length === 1) {
      // Single app — straightforward reverse proxy using container name
      const app = routableApps[0]
      args.push(
        '--label',
        `caddy.reverse_proxy=${app.containerName}:${app.port}`
      )
    } else {
      // Multi-app — sort by path specificity, root last
      const sorted = [...routableApps].sort((a, b) => {
        if (a.routePath === '/') return 1
        if (b.routePath === '/') return -1
        return b.routePath.length - a.routePath.length
      })

      sorted.forEach((app, i) => {
        if (app.routePath === '/') {
          args.push(
            '--label',
            `caddy.reverse_proxy=${app.containerName}:${app.port}`
          )
        } else {
          args.push('--label', `caddy.handle_path_${i}=${app.routePath}*`)
          args.push(
            '--label',
            `caddy.handle_path_${i}.reverse_proxy=${app.containerName}:${app.port}`
          )
        }
      })
    }

    // Add TLS email if configured
    const acmeEmail = await sails.helpers.setting.get('acmeEmail')
    if (acmeEmail) {
      args.push('--label', `caddy.tls=${acmeEmail}`)
    }

    args.push('alpine', 'sleep', 'infinity')

    return new Promise((resolve, reject) => {
      execFile(dockerPath, args, (err) => {
        if (err) {
          sails.log.error(
            `Route container creation failed for ${config.domains.join(
              ', '
            )}: ${err.message}`
          )
          throw 'caddyError'
        }
        sails.log.info(`Caddy route created for ${config.domains.join(', ')}`)
        resolve({
          domain: config.domain,
          domains: config.domains,
          routeId: routeContainerName,
          action: 'created'
        })
      })
    })
  }
}
