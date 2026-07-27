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
        id: values[association.alias]
      })
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
        const record = await model
          .findOne({ [definition.primaryKey]: definition.id })
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
      error.fieldErrors = Object.fromEntries(
        data.missing.map((alias) => [
          alias,
          `${resource.attributes?.[alias]?.label || alias} no longer exists.`
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
