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
    }
  },

  exits: {
    success: {
      responseType: 'inertia'
    },
    notFound: {
      responseType: 'redirect'
    }
  },

  fn: async function ({
    slug,
    envSlug,
    modelIdentity,
    page,
    perPage,
    sort,
    search
  }) {
    const user = await User.findOne({ id: this.req.session.userId }).populate(
      'team'
    )

    if (!user) {
      throw { notFound: '/login' }
    }

    const project = await Project.findOne({ slug, team: user.team.id })

    if (!project) {
      throw { notFound: '/' }
    }

    const environment = await Environment.findOne({
      project: project.id,
      slug: envSlug
    })

    if (!environment) {
      throw { notFound: `/projects/${slug}` }
    }

    const app =
      (await App.findOne({ environment: environment.id, isDefault: true })) ||
      (await App.findOne({ environment: environment.id }))
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

    if (appRunning) {
      try {
        const loaded = await sails.helpers.bridge.loadResource.with({
          containerName: app.containerName,
          environmentId: environment.id,
          modelIdentity,
          action: 'viewAny'
        })
        modelMeta = loaded.resource
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
            records = data.records || []
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
        error
      }
    }
  }
}
