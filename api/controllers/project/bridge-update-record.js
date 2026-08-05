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
    reauthenticate: {
      responseType: 'bridgeReauthenticate'
    },
    forbidden: {
      statusCode: 403
    },
    badRequest: {
      responseType: 'badRequest'
    },
    precognitionSuccess: {
      responseType: 'precognitionSuccess'
    }
  },

  fn: async function ({
    slug,
    envSlug,
    appSlug,
    modelIdentity,
    recordId,
    values
  }) {
    let resolved
    try {
      resolved = await sails.helpers.bridge.resolveRequest.with({
        req: this.req,
        projectSlug: slug,
        environmentSlug: envSlug,
        ...(appSlug ? { appSlug } : {}),
        requiredRole: 'editor',
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
    const { project, environment, app, actor, actorId, bridgeBasePath } =
      resolved
    const validateOnly = bridgeValidateOnly(this.req)

    let loaded
    let allowedValues
    try {
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
        surface: 'edit',
        uploadContext: {
          actorId,
          projectId: project.id,
          environmentId: environment.id
        },
        validateOnly
      })
      await sails.helpers.bridge.authorizeRelationshipValues.with({
        containerName: app.containerName,
        environmentId: environment.id,
        resource: loaded.resource,
        actor,
        values: allowedValues
      })
      await sails.helpers.bridge.validateResourceValues.with({
        containerName: app.containerName,
        resource: loaded.resource,
        values: allowedValues,
        recordId: loaded.recordId
      })
    } catch (error) {
      throw { badRequest: toBadRequest(error) }
    }

    if (sails.inertia.isPrecognitive(this.req)) {
      throw 'precognitionSuccess'
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
    return `${bridgeBasePath}/${modelIdentity}/${encodeURIComponent(
      String(recordId)
    )}`
  }
}

function toBadRequest(error) {
  if (!error?.fieldErrors) return { error: error.message }
  return {
    error: error.message,
    problems: Object.entries(error.fieldErrors).map(([field, message]) => ({
      [`values.${field}`]: message
    }))
  }
}

function bridgeValidateOnly(req) {
  return sails.inertia
    .validateOnly(req)
    .filter((field) => field.startsWith('values.'))
    .map((field) => field.slice('values.'.length))
}
