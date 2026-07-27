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
    },
    recordIds: {
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
    recordId,
    recordIds
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

    const actionDefinition = action
      ? resource.actionDefinitions?.[action]
      : null
    validateCustomActionContext({
      resource,
      action: actionDefinition,
      recordId,
      recordIds
    })

    let normalizedRecordId
    if (recordId !== undefined && recordId !== null) {
      normalizedRecordId = await sails.helpers.bridge.normalizeIdentifier.with({
        value: recordId,
        resource,
        label: `${resource.singularLabel || modelIdentity} identifier`
      })
    }
    let normalizedRecordIds
    if (Array.isArray(recordIds)) {
      normalizedRecordIds = []
      for (const value of recordIds) {
        const normalized = await sails.helpers.bridge.normalizeIdentifier.with({
          value,
          resource,
          label: `${resource.singularLabel || modelIdentity} identifier`
        })
        if (
          !normalizedRecordIds.some((candidate) =>
            Object.is(candidate, normalized)
          )
        ) {
          normalizedRecordIds.push(normalized)
        }
      }
    }

    const effective = await sails.helpers.bridge.authorizeResourceActions.with({
      containerName,
      resources: { resource },
      actor,
      ...(normalizedRecordId !== undefined
        ? { recordId: normalizedRecordId }
        : {}),
      ...(normalizedRecordIds !== undefined
        ? { recordIds: normalizedRecordIds }
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
      ...(actionDefinition
        ? { actionDefinition: resource.actionDefinitions[action] }
        : {}),
      ...(normalizedRecordId !== undefined
        ? { recordId: normalizedRecordId }
        : {}),
      ...(normalizedRecordIds !== undefined
        ? { recordIds: normalizedRecordIds }
        : {})
    }
  }
}

function validateCustomActionContext({
  resource,
  action,
  recordId,
  recordIds
}) {
  if (!action) return

  if (action.scope === 'record') {
    if (recordId === undefined || recordId === null || recordId === '') {
      throw actionContextError(
        `${resource.singularLabel} identifier is required for this action.`
      )
    }
    if (recordIds !== undefined) {
      throw actionContextError('This record action accepts one record only.')
    }
    return
  }

  if (action.scope === 'bulk') {
    if (!Array.isArray(recordIds) || recordIds.length === 0) {
      throw actionContextError('Select at least one record for this action.')
    }
    if (recordIds.length > 100) {
      throw actionContextError(
        'Select no more than 100 records for a custom action.'
      )
    }
    if (recordId !== undefined) {
      throw actionContextError('This bulk action requires a record selection.')
    }
    return
  }

  if (recordId !== undefined || recordIds !== undefined) {
    throw actionContextError(
      'This resource action does not accept record identifiers.'
    )
  }
}

function actionContextError(message) {
  const error = new Error(message)
  error.code = 'BRIDGE_ACTION_CONTEXT_INVALID'
  return error
}
