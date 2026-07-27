module.exports = {
  friendlyName: 'Bridge delete record',

  description: 'Delete a single record from a Waterline model.',

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
      responseType: 'redirect'
    },
    notFound: {
      responseType: 'redirect'
    },
    badRequest: {
      responseType: 'badRequest'
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
    if (!app || app.status !== 'running') {
      throw { badRequest: { error: 'App is not running' } }
    }

    let resource
    let normalizedRecordId
    try {
      const actor = await sails.helpers.bridge.buildActor.with({
        user,
        project,
        environment
      })
      const loaded = await sails.helpers.bridge.loadResource.with({
        containerName: app.containerName,
        environmentId: environment.id,
        modelIdentity,
        action: 'delete',
        actor,
        recordId
      })
      resource = loaded.resource
      normalizedRecordId = loaded.recordId
    } catch (error) {
      throw { badRequest: { error: error.message } }
    }

    const criteria = {
      [resource.primaryKey]: normalizedRecordId
    }
    const deleteCode = `
      const identity = ${JSON.stringify(resource.identity)};
      const criteria = ${JSON.stringify(criteria)};
      const model = sails.models[identity];
      if (!model) throw new Error('Configured Bridge model is unavailable.');

      const record = await model.destroyOne(criteria);
      return { success: !!record };
    `
    const wrappedCode = await sails.helpers.bridge.buildSailsWrapper(deleteCode)
    const result = await sails.helpers.bridge.executeInContainer(
      app.containerName,
      wrappedCode
    )

    if (!result.success) {
      throw { badRequest: { error: result.error || 'Failed to delete record' } }
    }

    // Redirect back to model list
    const envPath = envSlug !== 'production' ? `/environments/${envSlug}` : ''
    return `/projects/${slug}${envPath}/bridge/${modelIdentity}`
  }
}
