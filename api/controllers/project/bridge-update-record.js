module.exports = {
  friendlyName: 'Bridge update record',

  description: 'Update an existing record in a Waterline model.',

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
    },
    values: {
      type: 'ref',
      required: true,
      description: 'Record values to update'
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

  fn: async function ({ slug, envSlug, modelIdentity, recordId, values }) {
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
      const actor = await sails.helpers.bridge.buildActor.with({
        user,
        project,
        environment
      })
      loaded = await sails.helpers.bridge.loadResource.with({
        containerName: app.containerName,
        environmentId: environment.id,
        modelIdentity,
        action: 'update',
        actor,
        recordId
      })
      allowedValues = await sails.helpers.bridge.allowResourceValues.with({
        values,
        resource: loaded.resource,
        surface: 'edit'
      })
    } catch (error) {
      throw { badRequest: { error: error.message } }
    }

    const criteria = {
      [loaded.resource.primaryKey]: loaded.recordId
    }
    const updateCode = `
      const identity = ${JSON.stringify(loaded.resource.identity)};
      const criteria = ${JSON.stringify(criteria)};
      const values = ${JSON.stringify(allowedValues)};
      const model = sails.models[identity];
      if (!model) throw new Error('Configured Bridge model is unavailable.');

      const record = await model.updateOne(criteria).set(values);
      return { record };
    `
    const wrappedCode = await sails.helpers.bridge.buildSailsWrapper(updateCode)
    const result = await sails.helpers.bridge.executeInContainer(
      app.containerName,
      wrappedCode
    )

    if (!result.success) {
      throw { badRequest: { error: result.error || 'Failed to update record' } }
    }

    // Redirect back to record view
    const envPath = envSlug !== 'production' ? `/environments/${envSlug}` : ''
    return `/projects/${slug}${envPath}/bridge/${modelIdentity}/${encodeURIComponent(
      String(recordId)
    )}`
  }
}
