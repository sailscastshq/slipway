module.exports = {
  friendlyName: 'Generate route config',

  description: 'Generate Caddy route configuration for an environment (supports multi-app).',

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

    if (!environment) {
      throw 'notFound'
    }

    // Fetch all apps in this environment
    const apps = await App.find({ environment: environmentId })

    // Filter to apps with a hostPort (deployed) and a routePath (not workers)
    const routableApps = apps.filter(app => app.hostPort && app.routePath !== null)

    if (routableApps.length === 0) {
      return null // No apps deployed yet
    }

    const { fullDomain, domains } = await Environment.resolveDomains(environmentId)
    const routeId = `slipway-${environment.project.slug}-${environment.slug}`

    if (domains.length === 0) {
      return {
        domain: null,
        domains: [],
        route: null,
        environmentId: environment.id,
        projectSlug: environment.project.slug,
        environmentSlug: environment.slug
      }
    }

    // Single app with root path — identical config to original (backward compat)
    if (routableApps.length === 1 && routableApps[0].routePath === '/') {
      const app = routableApps[0]
      return {
        domain: fullDomain,
        domains,
        route: {
          '@id': routeId,
          match: [{ host: domains }],
          handle: [
            {
              handler: 'reverse_proxy',
              upstreams: [{ dial: `host.docker.internal:${app.hostPort}` }]
            }
          ],
          terminal: true
        },
        environmentId: environment.id,
        projectSlug: environment.project.slug,
        environmentSlug: environment.slug
      }
    }

    // Multi-app: build composite route with path-based sub-routes
    // Sort: specific paths first (/api, /admin), root (/) last as catch-all
    const sorted = [...routableApps].sort((a, b) => {
      if (a.routePath === '/') return 1
      if (b.routePath === '/') return -1
      // Longer paths first (more specific)
      return b.routePath.length - a.routePath.length
    })

    const handlers = []

    for (const app of sorted) {
      if (app.routePath === '/') {
        // Root catch-all — no path matcher needed
        handlers.push({
          handler: 'reverse_proxy',
          upstreams: [{ dial: `host.docker.internal:${app.hostPort}` }]
        })
      } else {
        // Path-specific sub-route
        handlers.push({
          handler: 'subroute',
          routes: [
            {
              match: [{ path: [`${app.routePath}*`] }],
              handle: [
                {
                  handler: 'reverse_proxy',
                  upstreams: [{ dial: `host.docker.internal:${app.hostPort}` }]
                }
              ]
            }
          ]
        })
      }
    }

    return {
      domain: fullDomain,
      domains,
      route: {
        '@id': routeId,
        match: [{ host: domains }],
        handle: handlers,
        terminal: true
      },
      environmentId: environment.id,
      projectSlug: environment.project.slug,
      environmentSlug: environment.slug
    }
  }
}
