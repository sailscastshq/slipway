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
      type: 'string',
      isIn: ['viewAny', 'view', 'create', 'update', 'delete', 'bulkDelete']
    }
  },

  exits: {
    success: {
      outputType: 'ref'
    }
  },

  fn: async function ({ containerName, environmentId, modelIdentity, action }) {
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
    const resource = hasResource ? contract.models[modelIdentity] : null

    if (!resource || resource.hidden) {
      const error = new Error(
        `Bridge resource "${modelIdentity}" was not found.`
      )
      error.code = 'BRIDGE_RESOURCE_NOT_FOUND'
      throw error
    }

    if (action && resource.actions?.[action] === false) {
      const error = new Error(
        `${resource.singularLabel || modelIdentity} does not allow this action.`
      )
      error.code = 'BRIDGE_ACTION_NOT_ALLOWED'
      error.action = action
      throw error
    }

    return { contract, resource }
  }
}
