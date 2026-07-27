module.exports = {
  friendlyName: 'Authorize Bridge resource actions',

  description:
    'Resolve effective Bridge actions through the target application authorization helper.',

  inputs: {
    containerName: {
      type: 'string',
      required: true
    },
    resources: {
      type: 'ref',
      required: true
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

  fn: async function ({ containerName, resources, actor, recordId }) {
    const effectiveResources = cloneResources(resources)
    const requests = []

    for (const [key, resource] of Object.entries(effectiveResources)) {
      const helperIdentity = resource.authorization?.helper
      if (!helperIdentity) continue
      if (!isSafeHelperIdentity(helperIdentity)) {
        const error = new Error(
          `Bridge resource "${
            resource.identity || key
          }" has an invalid authorization helper.`
        )
        error.code = 'BRIDGE_AUTHORIZATION_FAILED'
        throw error
      }

      for (const [action, enabled] of Object.entries(resource.actions || {})) {
        if (enabled !== true) continue
        if (!isSafeIdentifier(action)) {
          const error = new Error(
            `Bridge resource "${
              resource.identity || key
            }" has an invalid action.`
          )
          error.code = 'BRIDGE_AUTHORIZATION_FAILED'
          throw error
        }
        requests.push({
          key,
          action,
          helperIdentity,
          resource: {
            identity: resource.identity,
            primaryKey: resource.primaryKey,
            label: resource.label,
            singularLabel: resource.singularLabel
          }
        })
      }
    }

    if (requests.length === 0) return effectiveResources
    if (!actor || typeof actor !== 'object' || Array.isArray(actor)) {
      const error = new Error(
        'Bridge authorization requires an authenticated actor.'
      )
      error.code = 'BRIDGE_AUTHORIZATION_FAILED'
      throw error
    }

    const authorizationCode = `
      const requests = ${JSON.stringify(requests)};
      const actor = ${JSON.stringify(actor)};
      const recordId = ${JSON.stringify(recordId)};
      const decisions = Object.create(null);

      function resolveHelper(identity) {
        let helper = sails.helpers;
        for (const segment of identity.split('.')) {
          helper = helper && helper[segment];
        }
        if (!helper || typeof helper.with !== 'function') {
          throw new Error(
            'Configured Bridge authorization helper "' +
              identity +
              '" is unavailable.'
          );
        }
        return helper;
      }

      for (const request of requests) {
        const helper = resolveHelper(request.helperIdentity);
        const inputs = {
          actor,
          action: request.action,
          resource: request.resource
        };
        if (recordId !== undefined && recordId !== null) {
          inputs.recordId = recordId;
        }

        const result = await helper.with(inputs);
        decisions[request.key] = decisions[request.key] || {};
        decisions[request.key][request.action] =
          result === true ||
          (
            result &&
            typeof result === 'object' &&
            result.allowed === true
          );
      }

      return decisions;
    `
    const wrappedCode = await sails.helpers.bridge.buildSailsWrapper(
      authorizationCode
    )
    const result = await sails.helpers.bridge.executeInContainer(
      containerName,
      wrappedCode
    )

    if (!result.success) {
      const error = new Error(
        result.error || 'Target app Bridge authorization failed.'
      )
      error.code = 'BRIDGE_AUTHORIZATION_FAILED'
      throw error
    }

    let decisions
    try {
      decisions = JSON.parse(result.output)
    } catch (cause) {
      const error = new Error(
        'Failed to parse the target app Bridge authorization result.'
      )
      error.code = 'BRIDGE_AUTHORIZATION_FAILED'
      error.cause = cause
      throw error
    }

    for (const request of requests) {
      effectiveResources[request.key].actions[request.action] =
        decisions?.[request.key]?.[request.action] === true
    }

    return effectiveResources
  }
}

function cloneResources(resources) {
  if (!resources || typeof resources !== 'object' || Array.isArray(resources)) {
    const error = new Error('Bridge resources must be an object.')
    error.code = 'BRIDGE_AUTHORIZATION_FAILED'
    throw error
  }

  return JSON.parse(JSON.stringify(resources))
}

function isSafeIdentifier(value) {
  return (
    typeof value === 'string' &&
    /^[A-Za-z][A-Za-z0-9]*$/.test(value) &&
    !['__proto__', 'constructor', 'prototype'].includes(value)
  )
}

function isSafeHelperIdentity(value) {
  return (
    typeof value === 'string' &&
    value.split('.').every((part) => isSafeIdentifier(part))
  )
}
