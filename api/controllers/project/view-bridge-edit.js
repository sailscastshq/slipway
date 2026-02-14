module.exports = {
  friendlyName: 'View Bridge edit',

  description: 'Display the edit form for a record.',

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
    recordId: {
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

  fn: async function ({ slug, envSlug, modelIdentity, recordId }) {
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

    const app = await App.findOne({ environment: environment.id, isDefault: true }) || await App.findOne({ environment: environment.id })
    const appRunning = app && app.status === 'running'

    let modelMeta = null
    let record = null
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
            // Fetch the record
            const queryCode = `
              const record = await sails.models['${modelIdentity}'].findOne({ id: ${JSON.stringify(recordId)} });
              return { record };
            `
            const wrappedCode = await sails.helpers.bridge.buildSailsWrapper(queryCode)
            const result = await sails.helpers.bridge.executeInContainer(app.containerName, wrappedCode)

            if (result.success) {
              try {
                const data = JSON.parse(result.output)
                record = data.record
                if (!record) {
                  error = `Record with ID "${recordId}" not found.`
                }
              } catch (e) {
                error = 'Failed to parse record: ' + e.message
              }
            } else {
              error = result.error || 'Failed to fetch record'
            }

            // Load association options for belongsTo relationships
            if (!error) {
              const modelAssocs = (modelMeta.associations || []).filter(a => a.type === 'model')
              for (const assoc of modelAssocs) {
                try {
                  const assocQueryCode = `
                    const records = await sails.models['${assoc.model}'].find({ limit: 100 });
                    return records.map(r => ({
                      id: r.id,
                      label: r.name || r.title || r.email || \`#\${r.id}\`
                    }));
                  `
                  const assocWrappedCode = await sails.helpers.bridge.buildSailsWrapper(assocQueryCode)
                  const assocResult = await sails.helpers.bridge.executeInContainer(app.containerName, assocWrappedCode)

                  if (assocResult.success) {
                    try {
                      assocOptions[assoc.alias] = JSON.parse(assocResult.output)
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
        mode: 'edit',
        modelIdentity,
        recordId,
        appRunning,
        modelMeta,
        record,
        assocOptions,
        error
      }
    }
  }
}
