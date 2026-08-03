module.exports = {
  friendlyName: 'Generate route config',

  description:
    'Generate Caddy route configuration for an environment (supports multi-app).',

  inputs: {
    environmentId: {
      type: 'string',
      required: true,
      description: 'Environment ID'
    },
    apps: {
      type: 'ref',
      description:
        'Optional app snapshot to render instead of reading the current App records.'
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

  fn: async function ({ environmentId, apps }) {
    const environment = await Environment.findOne({
      id: environmentId
    }).populate('project')

    if (!environment) {
      throw 'notFound'
    }

    // Fetch all apps in this environment
    const environmentApps = Array.isArray(apps)
      ? apps
      : await App.find({ environment: environmentId })

    // Filter to apps with a hostPort (deployed) and a routePath (not workers)
    const routableApps = environmentApps.filter(
      (app) => app.hostPort && app.routePath !== null
    )

    if (routableApps.length === 0) {
      return null // No apps deployed yet
    }

    const { fullDomain, domains } = await Environment.resolveDomains(
      environmentId
    )
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

    // Single non-Bridge app with a root path — retain the minimal route.
    if (
      routableApps.length === 1 &&
      routableApps[0].routePath === '/' &&
      !routableApps[0].bridgeEnabled
    ) {
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
      if (!app.bridgeEnabled) continue
      handlers.push(
        ...bridgeHandlers({
          app,
          projectSlug: environment.project.slug,
          environmentSlug: environment.slug,
          controlPlaneUpstream: `${
            sails.config.custom.slipwayContainerName || 'slipway'
          }:1337`
        })
      )
    }

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

function bridgeHandlers({
  app,
  projectSlug,
  environmentSlug,
  controlPlaneUpstream
}) {
  const routePrefix =
    !app.routePath || app.routePath === '/'
      ? ''
      : `/${String(app.routePath).replace(/^\/+|\/+$/g, '')}`
  const publicBasePath = `${routePrefix}/bridge`
  const internalBasePath = `/projects/${projectSlug}/environments/${environmentSlug}/apps/${app.slug}/bridge`
  const reverseProxy = {
    handler: 'reverse_proxy',
    upstreams: [{ dial: controlPlaneUpstream }]
  }

  return [
    subroute(`${publicBasePath}/launch`, [
      { handler: 'rewrite', uri: '/bridge/launch' },
      reverseProxy
    ]),
    subroute(`${publicBasePath}/_assets/*`, [
      { handler: 'rewrite', strip_path_prefix: `${publicBasePath}/_assets` },
      reverseProxy
    ]),
    subroute(`${publicBasePath}*`, [
      { handler: 'rewrite', strip_path_prefix: publicBasePath },
      {
        handler: 'rewrite',
        uri: `${internalBasePath}{http.request.uri.path}`
      },
      reverseProxy
    ])
  ]
}

function subroute(path, handle) {
  return {
    handler: 'subroute',
    routes: [{ match: [{ path: [path] }], handle }]
  }
}

module.exports._private = { bridgeHandlers }
