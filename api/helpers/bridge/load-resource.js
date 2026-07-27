module.exports = {
  friendlyName: 'Load Bridge resource',

  description:
    'Load and authorize a normalized Bridge resource from a running app.',

  inputs: {
    containerName: {
      type: 'string',
      required: true
    },
    environmentId: {
      type: 'number',
      required: true
    },
    modelIdentity: {
      type: 'string',
      required: true
    },
    action: {
      type: 'string'
    },
    actor: {
      type: 'ref'
    },
    recordId: {
      type: 'ref'
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
    modelIdentity,
    action,
    actor,
    recordId
  }) {
    const contract = await sails.helpers.bridge.introspectModels(
      containerName,
      environmentId
    )

    if (contract.error) {
      const error = new Error(contract.error)
      error.code = 'BRIDGE_INTROSPECTION_FAILED'
      throw error
    }

    const hasResource = Object.prototype.hasOwnProperty.call(
      contract.models || {},
      modelIdentity
    )
    let resource = hasResource ? contract.models[modelIdentity] : null

    if (!resource || resource.hidden) {
      const error = new Error(
        `Bridge resource "${modelIdentity}" was not found.`
      )
      error.code = 'BRIDGE_RESOURCE_NOT_FOUND'
      throw error
    }

    if (
      action &&
      (!/^[A-Za-z][A-Za-z0-9]*$/.test(action) ||
        ['__proto__', 'constructor', 'prototype'].includes(action))
    ) {
      const error = new Error(`Bridge action "${action}" is invalid.`)
      error.code = 'BRIDGE_ACTION_NOT_ALLOWED'
      error.action = action
      throw error
    }

    let normalizedRecordId
    if (recordId !== undefined && recordId !== null) {
      normalizedRecordId = await sails.helpers.bridge.normalizeIdentifier.with({
        value: recordId,
        resource,
        label: `${resource.singularLabel || modelIdentity} identifier`
      })
    }

    const effective = await sails.helpers.bridge.authorizeResourceActions.with({
      containerName,
      resources: { resource },
      actor,
      ...(normalizedRecordId !== undefined
        ? { recordId: normalizedRecordId }
        : {})
    })
    resource = effective.resource

    if (
      action &&
      (!Object.prototype.hasOwnProperty.call(resource.actions || {}, action) ||
        resource.actions[action] !== true)
    ) {
      const error = new Error(
        `${resource.singularLabel || modelIdentity} does not allow this action.`
      )
      error.code = 'BRIDGE_ACTION_NOT_ALLOWED'
      error.action = action
      throw error
    }

    return {
      contract: {
        ...contract,
        models: {
          ...contract.models,
          [modelIdentity]: resource
        }
      },
      resource,
      ...(normalizedRecordId !== undefined
        ? { recordId: normalizedRecordId }
        : {})
    }
  }
}
