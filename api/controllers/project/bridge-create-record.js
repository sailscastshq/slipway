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
    appSlug: {
      type: 'string'
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
    forbidden: {
      statusCode: 403
    },
    badRequest: {
      responseType: 'badRequest'
    }
  },

  fn: async function ({ slug, envSlug, appSlug, modelIdentity, values }) {
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
      if (error.code === 'forbidden') throw 'forbidden'
      if (error.code === 'notFound') throw { notFound: '/' }
      throw { badRequest: { error: 'App is not running' } }
    }
    const { project, environment, app, actor, actorId } = resolved

    let loaded
    let allowedValues
    try {
      loaded = await sails.helpers.bridge.loadResource.with({
        containerName: app.containerName,
        environmentId: environment.id,
        modelIdentity,
        action: 'create',
        actor
      })
      allowedValues = await sails.helpers.bridge.allowResourceValues.with({
        values,
        resource: loaded.resource,
        surface: 'create',
        uploadContext: {
          actorId,
          projectId: project.id,
          environmentId: environment.id
        }
      })
      await sails.helpers.bridge.authorizeRelationshipValues.with({
        containerName: app.containerName,
        environmentId: environment.id,
        resource: loaded.resource,
        actor,
        values: allowedValues
      })
    } catch (error) {
      throw { badRequest: toBadRequest(error) }
    }

    try {
      const record = await sails.helpers.bridge.createRecord.with({
        containerName: app.containerName,
        resource: loaded.resource,
        values: allowedValues
      })
      const recordId = record?.[loaded.resource.primaryKey]

      const bridgeBasePath = appSlug
        ? `/projects/${slug}/environments/${envSlug}/apps/${app.slug}/bridge`
        : `/projects/${slug}/environments/${envSlug}/bridge`
      if (recordId !== undefined && recordId !== null) {
        return `${bridgeBasePath}/${
          loaded.resource.identity
        }/${encodeURIComponent(String(recordId))}`
      }
      return `${bridgeBasePath}/${loaded.resource.identity}`
    } catch (error) {
      throw { badRequest: toBadRequest(error) }
    }
  }
}

function toBadRequest(error) {
  if (!error?.fieldErrors) return { error: error.message }
  return {
    error: error.message,
    problems: Object.entries(error.fieldErrors).map(([field, message]) => ({
      [field]: message
    }))
  }
}
