module.exports = {
  friendlyName: 'View Bridge record',

  description: 'Display the detail view for a single record.',

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
            // Build populate clause for associations
            const collectionAssocs = (modelMeta.associations || [])
              .filter(a => a.type === 'collection')
              .map(a => `'${a.alias}'`)

            const populateChain = collectionAssocs.length > 0
              ? `.populate([${collectionAssocs.join(', ')}])`
              : ''

            // Fetch the record
            const queryCode = `
              const record = await sails.models['${modelIdentity}'].findOne({ id: ${JSON.stringify(recordId)} })${populateChain};
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
          }
        }
      } catch (err) {
        error = err.message
      }
    }

    return {
      page: 'projects/bridge-record',
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
        recordId,
        appRunning,
        modelMeta,
        record,
        error
      }
    }
  }
}
