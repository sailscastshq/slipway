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
    modelIdentity,
    relationshipAlias,
    surface,
    recordId,
    q,
    page
  }) {
    const user = await User.findOne({ id: this.req.session.userId }).populate(
      'team'
    )
    if (!user) throw 'forbidden'

    const project = await Project.findOne({ slug, team: user.team.id })
    if (!project) throw 'notFound'

    const environment = await Environment.findOne({
      project: project.id,
      slug: envSlug
    })
    if (!environment) throw 'notFound'

    const app =
      (await App.findOne({ environment: environment.id, isDefault: true })) ||
      (await App.findOne({ environment: environment.id }))
    if (!app || app.status !== 'running' || !app.containerName) {
      throw { badRequest: { error: 'App is not running' } }
    }
    if (surface !== 'create' && !recordId) {
      throw {
        badRequest: {
          error: 'A record identifier is required for this relationship.'
        }
      }
    }

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
