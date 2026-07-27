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

    if (!Array.isArray(ids) || ids.length === 0) {
      throw { badRequest: { error: 'No records selected' } }
    }
    if (ids.length > 500) {
      throw {
        badRequest: { error: 'Select no more than 500 records at a time.' }
      }
    }
    if (
      ids.some(
        (id) =>
          !['string', 'number'].includes(typeof id) ||
          (typeof id === 'string' && id.length > 200)
      )
    ) {
      throw { badRequest: { error: 'Record selection is invalid.' } }
    }

    let resource
    try {
      const loaded = await sails.helpers.bridge.loadResource.with({
        containerName: app.containerName,
        environmentId: environment.id,
        modelIdentity,
        action: 'bulkDelete'
      })
      resource = loaded.resource
    } catch (error) {
      throw { badRequest: { error: error.message } }
    }

    let normalizedIds
    try {
      normalizedIds = []
      for (const id of ids) {
        normalizedIds.push(
          await sails.helpers.bridge.normalizeIdentifier.with({
            value: id,
            resource,
            label: `${resource.singularLabel} identifier`
          })
        )
      }
    } catch (error) {
      throw { badRequest: { error: error.message } }
    }

    const criteria = {
      [resource.primaryKey]: { in: normalizedIds }
    }
    const deleteCode = `
      const identity = ${JSON.stringify(resource.identity)};
      const criteria = ${JSON.stringify(criteria)};
      const model = sails.models[identity];
      if (!model) throw new Error('Configured Bridge model is unavailable.');

      const deleted = await model.destroy(criteria).fetch();
      return { count: deleted.length };
    `
    const wrappedCode = await sails.helpers.bridge.buildSailsWrapper(deleteCode)
    const result = await sails.helpers.bridge.executeInContainer(
      app.containerName,
      wrappedCode
    )

    if (!result.success) {
      throw {
        badRequest: { error: result.error || 'Failed to delete records' }
      }
    }

    // Redirect back to model list
    const envPath = envSlug !== 'production' ? `/environments/${envSlug}` : ''
    return `/projects/${slug}${envPath}/bridge/${modelIdentity}`
  }
}
