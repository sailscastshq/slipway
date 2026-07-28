module.exports = {
  friendlyName: 'Bridge relationship options',

  description:
    'Return a bounded page of authorized relationship choices for Bridge.',

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
    relationshipAlias: {
      type: 'string',
      required: true
    },
    surface: {
      type: 'string',
      defaultsTo: 'create',
      isIn: ['create', 'edit', 'manage']
    },
    recordId: {
      type: 'string'
    },
    q: {
      type: 'string',
      defaultsTo: ''
    },
    page: {
      type: 'number',
      defaultsTo: 1
    }
  },

  exits: {
    success: {
      statusCode: 200
    },
    notFound: {
      statusCode: 404
    },
    forbidden: {
      statusCode: 403
    },
    badRequest: {
      responseType: 'badRequest'
    }
  },

  fn: async function ({
    slug,
    envSlug,
    appSlug,
    modelIdentity,
    relationshipAlias,
    surface,
    recordId,
    q,
    page
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
      if (error.code === 'forbidden') throw 'forbidden'
      if (error.code === 'notFound') throw 'notFound'
      throw { badRequest: { error: 'App is not running' } }
    }
    const { environment, app, actor } = resolved
    if (surface !== 'create' && !recordId) {
      throw {
        badRequest: {
          error: 'A record identifier is required for this relationship.'
        }
      }
    }

    try {
      const loaded = await sails.helpers.bridge.loadResource.with({
        containerName: app.containerName,
        environmentId: environment.id,
        modelIdentity,
        action: surface === 'create' ? 'create' : 'update',
        actor,
        ...(recordId ? { recordId } : {})
      })
      const relationship = loaded.resource.relationships?.[relationshipAlias]
      if (
        !relationship ||
        (surface !== 'manage' &&
          (relationship.type !== 'model' ||
            !loaded.resource[surface].includes(relationshipAlias))) ||
        (surface === 'manage' &&
          (relationship.type !== 'collection' || relationship.show !== true))
      ) {
        throw relationshipError(
          `Bridge relationship "${modelIdentity}.${relationshipAlias}" is unavailable.`
        )
      }
      if (
        surface === 'manage' &&
        relationship.attach !== true &&
        relationship.detach !== true
      ) {
        throw relationshipError(
          `Bridge relationship "${modelIdentity}.${relationshipAlias}" cannot be managed.`
        )
      }

      const related = await sails.helpers.bridge.loadResource.with({
        containerName: app.containerName,
        environmentId: environment.id,
        modelIdentity: relationship.resource,
        action: 'viewAny',
        actor
      })
      return await sails.helpers.bridge.searchRelationshipOptions.with({
        containerName: app.containerName,
        resources: {
          ...loaded.contract.models,
          [related.resource.identity]: related.resource
        },
        resource: loaded.resource,
        relationshipAlias,
        search: q,
        page,
        ...(loaded.recordId !== undefined ? { recordId: loaded.recordId } : {})
      })
    } catch (error) {
      throw { badRequest: { error: error.message } }
    }
  }
}

function relationshipError(message) {
  const error = new Error(message)
  error.code = 'BRIDGE_RELATIONSHIP_NOT_ALLOWED'
  return error
}
