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
    if (!app || app.status !== 'running') {
      throw { badRequest: { error: 'App is not running' } }
    }

    // Execute update in container
    const updateCode = `
      const record = await sails.models['${modelIdentity}'].updateOne({ id: ${JSON.stringify(recordId)} }).set(${JSON.stringify(values)});
      return { record };
    `
    const wrappedCode = await sails.helpers.bridge.buildSailsWrapper(updateCode)
    const result = await sails.helpers.bridge.executeInContainer(app.containerName, wrappedCode)

    if (!result.success) {
      throw { badRequest: { error: result.error || 'Failed to update record' } }
    }

    // Redirect back to record view
    const envPath = envSlug !== 'production' ? `/environments/${envSlug}` : ''
    return `/projects/${slug}${envPath}/bridge/${modelIdentity}/${recordId}`
  }
}
