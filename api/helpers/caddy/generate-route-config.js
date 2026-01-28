module.exports = {
  friendlyName: 'Generate route config',

  description: 'Generate Caddy route configuration for an environment.',

  inputs: {
    environmentId: {
      type: 'string',
      required: true,
      description: 'Environment ID'
    }
  },

  exits: {
    success: {
      description: 'Route config generated',
      outputType: 'ref'
    },
    notFound: {
      description: 'Environment not found'
    }
  },

  fn: async function ({ environmentId }) {
    const environment = await Environment.findOne({ id: environmentId })
      .populate('project')
      .populate('app')

    if (!environment) {
      throw 'notFound'
    }

    const app = environment.app && environment.app[0]
    if (!app || !app.hostPort) {
      return null // No app deployed yet
    }

    // Get the domain for this environment
    const domain = await Environment.getFullDomain(environmentId)

    // Generate Caddy route config
    // This follows Caddy's JSON config structure
    const routeConfig = {
      '@id': `slipway-${environment.project.slug}-${environment.slug}`,
      match: [
        {
          host: [domain]
        }
      ],
      handle: [
        {
          handler: 'reverse_proxy',
          upstreams: [
            {
              dial: `host.docker.internal:${app.hostPort}`
            }
          ]
        }
      ],
      terminal: true
    }

    return {
      domain,
      route: routeConfig,
      environmentId: environment.id,
      projectSlug: environment.project.slug,
      environmentSlug: environment.slug
    }
  }
}
