module.exports = {
  friendlyName: 'Bridge create record',

  description: 'Create a new record in a Waterline model.',

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
    values: {
      type: 'ref',
      required: true,
      description: 'Record values to create'
    }
  },

  exits: {
    success: {
      responseType: 'redirect'
    },
    notFound: {
      responseType: 'redirect'
    },
    badRequest: {
      responseType: 'badRequest'
    }
  },

  fn: async function ({ slug, envSlug, modelIdentity, values }) {
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
    if (!app || app.status !== 'running') {
      throw { badRequest: { error: 'App is not running' } }
    }

    let loaded
    let allowedValues
    try {
      loaded = await sails.helpers.bridge.loadResource.with({
        containerName: app.containerName,
        environmentId: environment.id,
        modelIdentity,
        action: 'create'
      })
      allowedValues = await sails.helpers.bridge.allowResourceValues.with({
        values,
        resource: loaded.resource,
        surface: 'create'
      })
    } catch (error) {
      throw { badRequest: { error: error.message } }
    }

    // Execute the allowlisted create in the target container.
    const createCode = `
      const identity = ${JSON.stringify(loaded.resource.identity)};
      const values = ${JSON.stringify(allowedValues)};
      const model = sails.models[identity];
      if (!model) throw new Error('Configured Bridge model is unavailable.');

      const record = await model.create(values).fetch();
      return { record };
    `
    const wrappedCode = await sails.helpers.bridge.buildSailsWrapper(createCode)
    const result = await sails.helpers.bridge.executeInContainer(
      app.containerName,
      wrappedCode
    )

    if (!result.success) {
      throw { badRequest: { error: result.error || 'Failed to create record' } }
    }

    // Parse the created record to get its ID
    let recordId
    try {
      const data = JSON.parse(result.output)
      recordId = data.record?.[loaded.resource.primaryKey]
    } catch {
      // Fallback to model list
    }

    // Redirect to the new record or model list
    const envPath = envSlug !== 'production' ? `/environments/${envSlug}` : ''
    if (recordId !== undefined && recordId !== null) {
      return `/projects/${slug}${envPath}/bridge/${modelIdentity}/${encodeURIComponent(
        String(recordId)
      )}`
    }
    return `/projects/${slug}${envPath}/bridge/${modelIdentity}`
  }
}
