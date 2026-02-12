module.exports = {
  friendlyName: 'Bridge bulk delete',

  description: 'Delete multiple records from a Waterline model.',

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
    ids: {
      type: 'ref',
      required: true,
      description: 'Array of record IDs to delete'
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

  fn: async function ({ slug, envSlug, modelIdentity, ids }) {
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
    if (!app || app.status !== 'running') {
      throw { badRequest: { error: 'App is not running' } }
    }

    if (!Array.isArray(ids) || ids.length === 0) {
      throw { badRequest: { error: 'No records selected' } }
    }

    // Execute bulk delete in container
    const deleteCode = `
      const deleted = await sails.models['${modelIdentity}'].destroy({ id: { in: ${JSON.stringify(ids)} } }).fetch();
      return { count: deleted.length };
    `
    const wrappedCode = await sails.helpers.bridge.buildSailsWrapper(deleteCode)
    const result = await sails.helpers.bridge.executeInContainer(app.containerName, wrappedCode)

    if (!result.success) {
      throw { badRequest: { error: result.error || 'Failed to delete records' } }
    }

    // Redirect back to model list
    const envPath = envSlug !== 'production' ? `/environments/${envSlug}` : ''
    return `/projects/${slug}${envPath}/bridge/${modelIdentity}`
  }
}
