module.exports = {
  friendlyName: 'View Bridge',

  description: 'Display the Bridge data management dashboard.',

  inputs: {
    slug: {
      type: 'string',
      required: true
    },
    envSlug: {
      type: 'string',
      defaultsTo: 'production'
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

  fn: async function ({ slug, envSlug }) {
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

    // Load models server-side if app is running
    let models = {}
    let modelsError = null

    if (appRunning) {
      try {
        const introspection = await sails.helpers.bridge.introspectModels(
          app.containerName,
          environment.id
        )

        if (introspection.error) {
          modelsError = introspection.error
        } else {
          models = introspection.models || {}

          // Get record counts for all models
          const identities = Object.keys(models)
          if (identities.length > 0) {
            const countCode = `
              const counts = {};
              ${identities.map(id => `
                try {
                  counts['${id}'] = await sails.models['${id}'].count();
                } catch(e) { counts['${id}'] = 0; }
              `).join('\n')}
              return counts;
            `
            const wrappedCode = await sails.helpers.bridge.buildSailsWrapper(countCode)
            const countResult = await sails.helpers.bridge.executeInContainer(app.containerName, wrappedCode)

            if (countResult.success) {
              try {
                const counts = JSON.parse(countResult.output)
                for (const id of identities) {
                  models[id].count = counts[id] || 0
                }
              } catch { /* counts remain undefined */ }
            }
          }
        }
      } catch (err) {
        modelsError = err.message
      }
    }

    return {
      page: 'projects/bridge',
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
        appRunning,
        models,
        modelsError
      }
    }
  }
}
