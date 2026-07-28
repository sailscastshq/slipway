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
    dashboard
  }) {
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
      if (error.code === 'forbidden') throw 'forbidden'
      throw { notFound: '/login' }
    }
    const { project, environment, app, actor } = resolved
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
        const normalizedQuery =
          await sails.helpers.bridge.normalizeResourceQuery.with({
            resource: modelMeta,
            page,
            perPage,
            sort,
            search
          })

        normalizedPage = normalizedQuery.page
        normalizedPerPage = normalizedQuery.perPage
        normalizedSort = normalizedQuery.sort
        normalizedSearch = normalizedQuery.search

        const queryCode = `
          const identity = ${JSON.stringify(modelMeta.identity)};
          const where = ${JSON.stringify(normalizedQuery.where)};
          const criteria = ${JSON.stringify(normalizedQuery.criteria)};
          const model = sails.models[identity];
          if (!model) throw new Error('Configured Bridge model is unavailable.');

          const total = await model.count(where);
          const records = await model.find(criteria);
          return { records, total };
        `
        const wrappedCode = await sails.helpers.bridge.buildSailsWrapper(
          queryCode
        )
        const result = await sails.helpers.bridge.executeInContainer(
          app.containerName,
          wrappedCode
        )

        if (result.success) {
          try {
            const data = JSON.parse(result.output)
            records = await sails.helpers.bridge.redactResourceRecords.with({
              records: data.records || [],
              resource: modelMeta,
              surface: 'list'
            })
            total = data.total || 0
            totalPages = Math.ceil(total / normalizedPerPage)
          } catch (parseError) {
            error = 'Failed to parse records: ' + parseError.message
          }
        } else {
          error = result.error || 'Failed to fetch records'
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
        error,
        dashboards,
        dashboardResources,
        activeDashboard
      }
    }
  }
}
