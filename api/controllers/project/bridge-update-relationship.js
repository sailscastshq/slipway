module.exports = {
  friendlyName: 'Bridge update relationship',

  description:
    'Attach or detach one related record through an explicitly manageable Waterline collection.',

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
    relationshipAlias: {
      type: 'string',
      required: true
    },
    operation: {
      type: 'string',
      required: true,
      isIn: ['attach', 'detach']
    },
    relatedId: {
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
    badRequest: {
      responseType: 'badRequest'
    }
  },

  fn: async function ({
    slug,
    envSlug,
    modelIdentity,
    recordId,
    relationshipAlias,
    operation,
    relatedId
  }) {
    const user = await User.findOne({ id: this.req.session.userId }).populate(
      'team'
    )
    if (!user) throw { notFound: '/login' }

    const project = await Project.findOne({ slug, team: user.team.id })
    if (!project) throw { notFound: '/' }

    const environment = await Environment.findOne({
      project: project.id,
      slug: envSlug
    })
    if (!environment) throw { notFound: `/projects/${slug}` }

    const app =
      (await App.findOne({ environment: environment.id, isDefault: true })) ||
      (await App.findOne({ environment: environment.id }))
    if (!app || app.status !== 'running' || !app.containerName) {
      throw { badRequest: { error: 'App is not running' } }
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
        action: 'update',
        actor,
        recordId
      })
      const relationship = loaded.resource.relationships?.[relationshipAlias]
      if (
        !relationship ||
        relationship.type !== 'collection' ||
        relationship[operation] !== true
      ) {
        throw relationshipError(
          `${loaded.resource.singularLabel} does not allow this relationship operation.`
        )
      }

      const related = await sails.helpers.bridge.loadResource.with({
        containerName: app.containerName,
        environmentId: environment.id,
        modelIdentity: relationship.resource,
        action: 'viewAny',
        actor
      })
      const normalizedRelatedId =
        await sails.helpers.bridge.normalizeIdentifier.with({
          value: relatedId,
          resource: related.resource,
          label: `${related.resource.singularLabel} identifier`
        })

      const definition = {
        parentIdentity: loaded.resource.identity,
        parentPrimaryKey: loaded.resource.primaryKey,
        parentId: loaded.recordId,
        alias: relationship.alias,
        relatedIdentity: related.resource.identity,
        relatedPrimaryKey: related.resource.primaryKey,
        relatedId: normalizedRelatedId,
        operation
      }
      const mutationCode = `
        const definition = ${JSON.stringify(definition)};
        const parentModel = sails.models[definition.parentIdentity];
        const relatedModel = sails.models[definition.relatedIdentity];
        if (!parentModel || !relatedModel) {
          throw new Error('Configured Bridge relationship model is unavailable.');
        }

        const [parent, related] = await Promise.all([
          parentModel
            .findOne({
              [definition.parentPrimaryKey]: definition.parentId
            })
            .select([definition.parentPrimaryKey]),
          relatedModel
            .findOne({
              [definition.relatedPrimaryKey]: definition.relatedId
            })
            .select([definition.relatedPrimaryKey])
        ]);
        if (!parent) throw new Error('The parent record no longer exists.');
        if (!related) throw new Error('The related record no longer exists.');

        if (definition.operation === 'attach') {
          await parentModel
            .addToCollection(definition.parentId, definition.alias)
            .members([definition.relatedId]);
        } else {
          await parentModel
            .removeFromCollection(definition.parentId, definition.alias)
            .members([definition.relatedId]);
        }
        return { success: true };
      `
      const wrappedCode = await sails.helpers.bridge.buildSailsWrapper(
        mutationCode
      )
      const result = await sails.helpers.bridge.executeInContainer(
        app.containerName,
        wrappedCode
      )
      if (!result.success) {
        throw new Error(
          result.error || `Failed to ${operation} the related record.`
        )
      }
    } catch (error) {
      throw { badRequest: { error: error.message } }
    }

    const envPath = envSlug !== 'production' ? `/environments/${envSlug}` : ''
    return `/projects/${slug}${envPath}/bridge/${modelIdentity}/${encodeURIComponent(
      String(recordId)
    )}`
  }
}

function relationshipError(message) {
  const error = new Error(message)
  error.code = 'BRIDGE_RELATIONSHIP_NOT_ALLOWED'
  return error
}
