module.exports = {
  friendlyName: 'View Bridge create',

  description: 'Display the create form for a Waterline model.',

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

  fn: async function ({ slug, envSlug, modelIdentity }) {
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

    let modelMeta = null
    let assocOptions = {}
    let error = null

    if (appRunning) {
      try {
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
            // Load association options for belongsTo relationships
            const modelAssocs = (modelMeta.associations || []).filter(a => a.type === 'model')
            for (const assoc of modelAssocs) {
              try {
                const queryCode = `
                  const records = await sails.models['${assoc.model}'].find({ limit: 100 });
                  return records.map(r => ({
                    id: r.id,
                    label: r.name || r.title || r.email || \`#\${r.id}\`
                  }));
                `
                const wrappedCode = await sails.helpers.bridge.buildSailsWrapper(queryCode)
                const result = await sails.helpers.bridge.executeInContainer(app.containerName, wrappedCode)

                if (result.success) {
                  try {
                    assocOptions[assoc.alias] = JSON.parse(result.output)
                  } catch {
                    assocOptions[assoc.alias] = []
                  }
                } else {
                  assocOptions[assoc.alias] = []
                }
              } catch {
                assocOptions[assoc.alias] = []
              }
            }
          }
        }
      } catch (err) {
        error = err.message
      }
    }

    return {
      page: 'projects/bridge-form',
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
        mode: 'create',
        modelIdentity,
        recordId: null,
        appRunning,
        modelMeta,
        record: null,
        assocOptions,
        error
      }
    }
  }
}
