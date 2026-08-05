module.exports = {
  friendlyName: 'View Bridge model',

  description: 'Display the records table for a specific Waterline model.',

  inputs: {
    slug: {
      type: 'string',
      required: true
    },
    envSlug: {
      type: 'string',
      defaultsTo: 'production'
    },
    appSlug: {
      type: 'string'
    },
    modelIdentity: {
      type: 'string',
      required: true
    },
    page: {
      type: 'number',
      defaultsTo: 1
    },
    perPage: {
      type: 'number',
      defaultsTo: 20
    },
    sort: {
      type: 'string',
      defaultsTo: ''
    },
    search: {
      type: 'string',
      defaultsTo: ''
    },
    filters: {
      type: 'string',
      defaultsTo: ''
    },
    lens: {
      type: 'string',
      defaultsTo: ''
    },
    dashboard: {
      type: 'string',
      defaultsTo: ''
    }
  },

  exits: {
    success: {
      responseType: 'inertia'
    },
    notFound: {
      responseType: 'redirect'
    },
    reauthenticate: {
      responseType: 'bridgeReauthenticate'
    },
    forbidden: {
      statusCode: 403
    }
  },

  fn: async function ({
    slug,
    envSlug,
    appSlug,
    modelIdentity,
    page,
    perPage,
    sort,
    search,
    filters,
    lens,
    dashboard
  }) {
    const partialProps = inertiaPartialProps(this.req)
    const shouldLoadDashboard =
      partialProps.size === 0 ||
      ['activeDashboard', 'dashboards', 'dashboardResources'].some((prop) =>
        partialProps.has(prop)
      )
    const shouldLoadRecords =
      partialProps.size === 0 ||
      [
        'records',
        'total',
        'totalPages',
        'currentPage',
        'perPage',
        'sort',
        'search',
        'filterState',
        'filterDefinitions',
        'columns',
        'lenses',
        'activeLens'
      ].some((prop) => partialProps.has(prop))
    let resolved
    try {
      resolved = await sails.helpers.bridge.resolveRequest.with({
        req: this.req,
        projectSlug: slug,
        environmentSlug: envSlug,
        ...(appSlug ? { appSlug } : {}),
        requiredRole: 'viewer'
      })
    } catch (error) {
      if (error.code === 'reauthenticate') {
        throw { reauthenticate: error.raw || error }
      }
      if (error.code === 'forbidden') throw 'forbidden'
      throw { notFound: '/login' }
    }
    const {
      project,
      environment,
      app,
      actor,
      bridgeBasePath,
      bridgeApiBasePath,
      bridgeAssetBasePath,
      bridgeHostOrigin
    } = resolved
    const appRunning = app && app.status === 'running'

    // Load model metadata and records server-side
    let modelMeta = null
    let records = []
    let total = 0
    let totalPages = 0
    let error = null
    let normalizedPage = page
    let normalizedPerPage = perPage
    let normalizedSort = sort
    let normalizedSearch = search
    let normalizedFilters = {}
    let columns = []
    let lenses = []
    let activeLens = null
    let filterDefinitions = {}
    let dashboards = []
    let dashboardResources = {}
    let activeDashboard = null

    if (appRunning) {
      try {
        const loaded = await sails.helpers.bridge.loadResource.with({
          containerName: app.containerName,
          environmentId: environment.id,
          modelIdentity,
          action: 'viewAny',
          actor
        })
        modelMeta = loaded.resource
        if (shouldLoadDashboard) {
          const dashboardDefinitions = Object.values(
            loaded.contract.dashboards || {}
          ).filter(
            (definition) =>
              definition.scope === 'resource' &&
              definition.resource === modelIdentity
          )
          dashboards = dashboardDefinitions.map((definition) => ({
            id: definition.id,
            label: definition.label,
            scope: definition.scope
          }))
          const selectedDashboard =
            dashboardDefinitions.find(
              (definition) => definition.id === dashboard
            ) ||
            dashboardDefinitions.find((definition) => definition.default) ||
            dashboardDefinitions[0]

          if (selectedDashboard) {
            const authorizedResources =
              await sails.helpers.bridge.authorizeResourceActions.with({
                containerName: app.containerName,
                resources: loaded.contract.models,
                actor
              })
            const authorizedDashboardResources = Object.fromEntries(
              Object.entries(authorizedResources).filter(
                ([, resource]) => !resource.hidden
              )
            )
            dashboardResources = Object.fromEntries(
              Object.entries(authorizedResources).filter(
                ([, resource]) =>
                  !resource.hidden && resource.actions?.viewAny !== false
              )
            )
            activeDashboard = await sails.helpers.bridge.resolveDashboard.with({
              containerName: app.containerName,
              dashboard: selectedDashboard,
              resources: authorizedDashboardResources,
              actor
            })
          }
        }

        if (shouldLoadRecords) {
          const normalizedQuery =
            await sails.helpers.bridge.normalizeResourceQuery.with({
              resource: modelMeta,
              page,
              perPage,
              sort,
              search,
              filters,
              lens
            })

          normalizedPage = normalizedQuery.page
          normalizedPerPage = normalizedQuery.perPage
          normalizedSort = normalizedQuery.sort
          normalizedSearch = normalizedQuery.search
          normalizedFilters = normalizedQuery.filters
          columns = normalizedQuery.columns
          activeLens = normalizedQuery.lens
          filterDefinitions = normalizedQuery.filterDefinitions
          lenses = Object.values(modelMeta.lenses || {}).map((definition) => ({
            id: definition.id,
            label: definition.label,
            default: definition.default
          }))

          const data = await sails.helpers.bridge.queryResource.with({
            containerName: app.containerName,
            resource: modelMeta,
            query: normalizedQuery,
            actor
          })
          records = await sails.helpers.bridge.redactResourceRecords.with({
            records: data.records || [],
            resource: {
              ...modelMeta,
              list: normalizedQuery.select
            },
            surface: 'list'
          })
          total = data.total || 0
          totalPages = Math.ceil(total / normalizedPerPage)
        }
      } catch (err) {
        error = err.message
      }
    }

    return {
      page: 'projects/bridge-model',
      props: {
        project: {
          id: project.id,
          name: project.name,
          slug: project.slug
        },
        environment: {
          id: environment.id,
          name: environment.name,
          slug: environment.slug
        },
        app: { id: app.id, name: app.name, slug: app.slug },
        appScoped: Boolean(appSlug),
        bridgeRequestBasePath: bridgeBasePath,
        bridgeRequestApiBasePath: bridgeApiBasePath,
        hostBridgeAssetBasePath: bridgeAssetBasePath,
        hostBridgeOrigin: bridgeHostOrigin,
        modelIdentity,
        appRunning,
        modelMeta,
        records,
        total,
        totalPages,
        currentPage: normalizedPage,
        perPage: normalizedPerPage,
        sort: normalizedSort,
        search: normalizedSearch,
        filterState: normalizedFilters,
        filterDefinitions,
        columns,
        lenses,
        activeLens: activeLens
          ? {
              id: activeLens.id,
              label: activeLens.label,
              default: activeLens.default
            }
          : null,
        error,
        dashboards,
        dashboardResources,
        activeDashboard
      }
    }
  }
}

function inertiaPartialProps(req) {
  if (
    req.get('X-Inertia') !== 'true' ||
    req.get('X-Inertia-Partial-Component') !== 'projects/bridge-model'
  ) {
    return new Set()
  }

  return new Set(
    String(req.get('X-Inertia-Partial-Data') || '')
      .split(',')
      .map((value) => value.trim())
      .filter(Boolean)
  )
}
