module.exports = {
  friendlyName: 'Authorize Bridge relationship values',

  description:
    'Authorize and verify belongs-to values before a Bridge record mutation.',

  inputs: {
    containerName: {
      type: 'string',
      required: true
    },
    environmentId: {
      type: 'number',
      required: true
    },
    resource: {
      type: 'ref',
      required: true
    },
    actor: {
      type: 'ref',
      required: true
    },
    values: {
      type: 'ref',
      required: true
    }
  },

  exits: {
    success: {
      outputType: 'ref'
    }
  },

  fn: async function ({
    containerName,
    environmentId,
    resource,
    actor,
    values
  }) {
    const definitions = []
    const unresolved = {}

    for (const association of resource.associations || []) {
      if (
        association.type !== 'model' ||
        !Object.prototype.hasOwnProperty.call(values, association.alias) ||
        values[association.alias] === null ||
        values[association.alias] === ''
      ) {
        continue
      }

      const relationship = resource.relationships?.[association.alias]
      if (!relationship) {
        throw relationshipError(
          `Bridge relationship "${resource.identity}.${association.alias}" is unavailable.`
        )
      }

      const scope = await sails.helpers.bridge.resolveRelationshipScope.with({
        resource,
        relationship,
        values
      })
      if (!scope.ready) {
        const sourceField = scope.missing[0]
        unresolved[association.alias] = `Choose ${
          resource.attributes?.[sourceField]?.label || sourceField
        } before ${relationship.label}.`
        continue
      }

      let related
      try {
        related = await sails.helpers.bridge.loadResource.with({
          containerName,
          environmentId,
          modelIdentity: relationship.resource,
          action: 'viewAny',
          actor
        })
      } catch {
        throw relationshipError(
          `${relationship.label} is not available to the current actor.`
        )
      }

      definitions.push({
        alias: association.alias,
        identity: related.resource.identity,
        primaryKey: related.resource.primaryKey,
        id: values[association.alias],
        where: scope.where,
        invalidMessage: relationshipScopeMessage({
          resource,
          relationship
        })
      })
    }

    if (Object.keys(unresolved).length > 0) {
      const error = relationshipError(
        'Some selected Bridge relationships need more context.'
      )
      error.code = 'BRIDGE_RELATIONSHIP_SCOPE_REQUIRED'
      error.fieldErrors = unresolved
      throw error
    }

    if (definitions.length === 0) return values

    const verificationCode = `
      const definitions = ${JSON.stringify(definitions)};
      const missing = [];

      for (const definition of definitions) {
        const model = sails.models[definition.identity];
        if (!model) {
          throw new Error('Configured Bridge relationship model is unavailable.');
        }
        const identity = { [definition.primaryKey]: definition.id };
        const criteria = Object.keys(definition.where).length > 0
          ? { and: [definition.where, identity] }
          : identity;
        const record = await model
          .findOne(criteria)
          .select([definition.primaryKey]);
        if (!record) missing.push(definition.alias);
      }

      return { missing };
    `
    const wrappedCode = await sails.helpers.bridge.buildSailsWrapper(
      verificationCode
    )
    const result = await sails.helpers.bridge.executeInContainer(
      containerName,
      wrappedCode
    )
    if (!result.success) {
      const error = relationshipError(
        result.error || 'Failed to verify Bridge relationship values.'
      )
      error.code = 'BRIDGE_RELATIONSHIP_VERIFICATION_FAILED'
      throw error
    }

    let data
    try {
      data = JSON.parse(result.output)
    } catch (cause) {
      const error = relationshipError(
        'Failed to parse Bridge relationship verification.'
      )
      error.code = 'BRIDGE_RELATIONSHIP_VERIFICATION_FAILED'
      error.cause = cause
      throw error
    }

    if (Array.isArray(data.missing) && data.missing.length > 0) {
      const error = relationshipError(
        'Some selected Bridge relationships no longer exist.'
      )
      error.code = 'BRIDGE_RELATIONSHIP_NOT_FOUND'
      const definitionsByAlias = new Map(
        definitions.map((definition) => [definition.alias, definition])
      )
      error.fieldErrors = Object.fromEntries(
        data.missing.map((alias) => [
          alias,
          definitionsByAlias.get(alias)?.invalidMessage ||
            `${resource.attributes?.[alias]?.label || alias} is unavailable.`
        ])
      )
      throw error
    }

    return values
  }
}

function relationshipError(message) {
  const error = new Error(message)
  error.code = 'BRIDGE_RELATIONSHIP_NOT_ALLOWED'
  return error
}

function relationshipScopeMessage({ resource, relationship }) {
  const dependency = Object.values(relationship.where || {}).find(
    (constraint) => constraint?.fromField
  )
  if (dependency) {
    const source = resource.attributes?.[dependency.fromField]
    return `${relationship.label} is not available for the selected ${(
      source?.label || dependency.fromField
    ).toLowerCase()}.`
  }
  if (Object.keys(relationship.where || {}).length > 0) {
    return `${relationship.label} is not eligible for this field.`
  }
  return `${relationship.label} no longer exists.`
}
