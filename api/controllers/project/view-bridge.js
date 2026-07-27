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
          models = Object.fromEntries(
            Object.entries(introspection.models || {}).filter(
              ([, resource]) =>
                !resource.hidden && resource.actions?.viewAny !== false
            )
          )

          // Get record counts for all models
          const definitions = Object.entries(models).map(([key, resource]) => ({
            key,
            identity: resource.identity
          }))
          if (definitions.length > 0) {
            const countCode = `
              const definitions = ${JSON.stringify(definitions)};
              const counts = {};
              for (const definition of definitions) {
                try {
                  counts[definition.key] =
                    await sails.models[definition.identity].count();
                } catch (error) {
                  counts[definition.key] = 0;
                }
              }
              return counts;
            `
            const wrappedCode = await sails.helpers.bridge.buildSailsWrapper(
              countCode
            )
            const countResult = await sails.helpers.bridge.executeInContainer(
              app.containerName,
              wrappedCode
            )

            if (countResult.success) {
              try {
                const counts = JSON.parse(countResult.output)
                for (const definition of definitions) {
                  models[definition.key].count = counts[definition.key] || 0
                }
              } catch {
                /* counts remain undefined */
              }
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
