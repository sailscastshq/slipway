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

    let modelMeta = null
    let record = null
    let assocOptions = {}
    let error = null

    if (appRunning) {
      try {
        const loaded = await sails.helpers.bridge.loadResource.with({
          containerName: app.containerName,
          environmentId: environment.id,
          modelIdentity,
          action: 'update'
        })
        modelMeta = loaded.resource

        const criteria = {
          [modelMeta.primaryKey]: recordId
        }
        const fields = Array.from(
          new Set([modelMeta.primaryKey, ...modelMeta.edit])
        ).filter(
          (field) =>
            field === modelMeta.primaryKey ||
            (!modelMeta.attributes[field].encrypt &&
              !modelMeta.attributes[field].protect)
        )
        const queryCode = `
          const identity = ${JSON.stringify(modelMeta.identity)};
          const criteria = ${JSON.stringify(criteria)};
          const fields = ${JSON.stringify(fields)};
          const model = sails.models[identity];
          if (!model) throw new Error('Configured Bridge model is unavailable.');

          const record = await model.findOne(criteria).select(fields);
          return { record };
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
            record = data.record
            if (!record) {
              error = `Record with ID "${recordId}" not found.`
            }
          } catch (parseError) {
            error = 'Failed to parse record: ' + parseError.message
          }
        } else {
          error = result.error || 'Failed to fetch record'
        }

        if (!error) {
          assocOptions = await sails.helpers.bridge.loadAssociationOptions.with(
            {
              containerName: app.containerName,
              resources: loaded.contract.models,
              resource: modelMeta,
              surface: 'edit'
            }
          )
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
