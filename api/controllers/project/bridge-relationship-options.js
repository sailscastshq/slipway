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
      isIn: ['create', 'edit', 'filter', 'manage']
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
    },
    dependencies: {
      type: 'string',
      defaultsTo: '',
      maxLength: 2000
    }
  },

  exits: {
    success: {
      statusCode: 200
    },
    notFound: {
      statusCode: 404
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

  fn: async function ({
    slug,
    envSlug,
    appSlug,
    modelIdentity,
    relationshipAlias,
    surface,
    recordId,
    q,
    page,
    dependencies
  }) {
    let resolved
    try {
      resolved = await sails.helpers.bridge.resolveRequest.with({
        req: this.req,
        projectSlug: slug,
        environmentSlug: envSlug,
        ...(appSlug ? { appSlug } : {}),
        requiredRole: surface === 'filter' ? 'viewer' : 'editor',
        requireRunning: true
      })
    } catch (error) {
      if (error.code === 'reauthenticate') {
        throw { reauthenticate: error.raw || error }
      }
      if (error.code === 'forbidden') throw 'forbidden'
      if (error.code === 'notFound') throw 'notFound'
      throw { badRequest: { error: 'App is not running' } }
    }
    const { environment, app, actor } = resolved
    if (['edit', 'manage'].includes(surface) && !recordId) {
      throw {
        badRequest: {
          error: 'A record identifier is required for this relationship.'
        }
      }
    }

    try {
      const dependencyValues = parseDependencyValues(dependencies)
      const loaded = await sails.helpers.bridge.loadResource.with({
        containerName: app.containerName,
        environmentId: environment.id,
        modelIdentity,
        action:
          surface === 'create'
            ? 'create'
            : surface === 'filter'
            ? 'viewAny'
            : 'update',
        actor,
        ...(recordId ? { recordId } : {})
      })
      const relationship = loaded.resource.relationships?.[relationshipAlias]
      if (
        !relationship ||
        (surface === 'filter' &&
          (relationship.type !== 'model' ||
            !loaded.resource.filters.includes(relationshipAlias))) ||
        (surface !== 'filter' &&
          surface !== 'manage' &&
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
        values: dependencyValues,
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

function parseDependencyValues(value) {
  if (!value) return {}

  let parsed
  try {
    parsed = JSON.parse(value)
  } catch {
    throw relationshipError('Bridge relationship dependencies are invalid.')
  }
  if (
    !parsed ||
    typeof parsed !== 'object' ||
    Array.isArray(parsed) ||
    ![Object.prototype, null].includes(Object.getPrototypeOf(parsed))
  ) {
    throw relationshipError('Bridge relationship dependencies are invalid.')
  }

  for (const key of Object.keys(parsed)) {
    if (
      !/^[A-Za-z][A-Za-z0-9]*$/.test(key) ||
      ['__proto__', 'constructor', 'prototype'].includes(key)
    ) {
      throw relationshipError('Bridge relationship dependencies are invalid.')
    }
  }
  return parsed
}
