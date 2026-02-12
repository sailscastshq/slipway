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
      defaultsTo: 'createdAt DESC'
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

  fn: async function ({ slug, envSlug, modelIdentity, page, perPage, sort, search }) {
    const user = await User.findOne({ id: this.req.session.userId }).populate('team')

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

    const app = await App.findOne({ environment: environment.id })
    const appRunning = app && app.status === 'running'

    // Load model metadata and records server-side
    let modelMeta = null
    let records = []
    let total = 0
    let totalPages = 0
    let error = null

    if (appRunning) {
      try {
        // Get model introspection
        const introspection = await sails.helpers.bridge.introspectModels(
          app.containerName,
          environment.id
        )

        if (introspection.error) {
          error = introspection.error
        } else {
          modelMeta = introspection.models[modelIdentity]

          if (!modelMeta) {
            error = `Model "${modelIdentity}" not found.`
          } else {
            // Fetch records
            const pk = modelMeta.primaryKey || 'id'
            const skip = (page - 1) * perPage

            // Build query code
            let queryCode
            if (search) {
              // Simple search: look for string fields containing the search term
              const stringAttrs = Object.entries(modelMeta.attributes)
                .filter(([, attr]) => attr.type === 'string' && !attr.encrypt)
                .map(([name]) => name)

              if (stringAttrs.length > 0) {
                const orClauses = stringAttrs.map(attr =>
                  `{ ${attr}: { contains: '${search.replace(/'/g, "\\'")}' } }`
                ).join(', ')

                queryCode = `
                  const total = await sails.models['${modelIdentity}'].count({ or: [${orClauses}] });
                  const records = await sails.models['${modelIdentity}'].find({
                    where: { or: [${orClauses}] },
                    skip: ${skip},
                    limit: ${perPage},
                    sort: '${sort}'
                  });
                  return { records, total };
                `
              } else {
                queryCode = `
                  const total = await sails.models['${modelIdentity}'].count();
                  const records = await sails.models['${modelIdentity}'].find({
                    skip: ${skip},
                    limit: ${perPage},
                    sort: '${sort}'
                  });
                  return { records, total };
                `
              }
            } else {
              queryCode = `
                const total = await sails.models['${modelIdentity}'].count();
                const records = await sails.models['${modelIdentity}'].find({
                  skip: ${skip},
                  limit: ${perPage},
                  sort: '${sort}'
                });
                return { records, total };
              `
            }

            const wrappedCode = await sails.helpers.bridge.buildSailsWrapper(queryCode)
            const result = await sails.helpers.bridge.executeInContainer(app.containerName, wrappedCode)

            if (result.success) {
              try {
                const data = JSON.parse(result.output)
                records = data.records || []
                total = data.total || 0
                totalPages = Math.ceil(total / perPage)
              } catch (e) {
                error = 'Failed to parse records: ' + e.message
              }
            } else {
              error = result.error || 'Failed to fetch records'
            }
          }
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
        currentPage: page,
        perPage,
        sort,
        search,
        error
      }
    }
  }
}
