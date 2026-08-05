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
    appSlug: {
      type: 'string'
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
    reauthenticate: {
      responseType: 'bridgeReauthenticate'
    },
    forbidden: {
      statusCode: 403
    },
    badRequest: {
      responseType: 'badRequest'
    }
  },

  fn: async function ({ slug, envSlug, appSlug, modelIdentity, ids }) {
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
      if (error.code === 'reauthenticate') {
        throw { reauthenticate: error.raw || error }
      }
      if (error.code === 'forbidden') throw 'forbidden'
      if (error.code === 'notFound') throw { notFound: '/' }
      throw { badRequest: { error: 'App is not running' } }
    }
    const { project, environment, app, actor, bridgeBasePath } = resolved

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
        action: 'bulkDelete',
        actor
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
    return `${bridgeBasePath}/${modelIdentity}`
  }
}
