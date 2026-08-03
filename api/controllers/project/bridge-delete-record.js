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
    appSlug: {
      type: 'string'
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
    forbidden: {
      statusCode: 403
    },
    badRequest: {
      responseType: 'badRequest'
    }
  },

  fn: async function ({ slug, envSlug, appSlug, modelIdentity, recordId }) {
    let resolved
    try {
      resolved = await sails.helpers.bridge.resolveRequest.with({
        req: this.req,
        projectSlug: slug,
        environmentSlug: envSlug,
        ...(appSlug ? { appSlug } : {}),
        requiredRole: 'administrator',
        requireRunning: true
      })
    } catch (error) {
      if (error.code === 'forbidden') throw 'forbidden'
      if (error.code === 'notFound') throw { notFound: '/' }
      throw { badRequest: { error: 'App is not running' } }
    }
    const { project, environment, app, actor, bridgeBasePath } = resolved

    let resource
    let normalizedRecordId
    try {
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
    return `${bridgeBasePath}/${modelIdentity}`
  }
}
