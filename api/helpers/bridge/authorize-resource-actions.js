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
    resources,
    actor,
    recordId,
    recordIds
  }) {
    const effectiveResources = cloneResources(resources)
    const requests = []

    for (const [key, resource] of Object.entries(effectiveResources)) {
      const helperIdentity = resource.authorization?.helper
      const roleAuthorization =
        resource.authorization?.mode === 'roles' ? resource.authorization : null
      if (!helperIdentity && !roleAuthorization) continue
      if (helperIdentity && !isSafeHelperIdentity(helperIdentity)) {
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
          ...(helperIdentity ? { helperIdentity } : {}),
          ...(roleAuthorization ? { roleAuthorization } : {}),
          scope: resource.actionDefinitions?.[action]?.scope || null,
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
      const recordIds = ${JSON.stringify(recordIds)};
      const decisions = Object.create(null);
      const actorId =
        actor && actor.id !== undefined && actor.id !== null
          ? String(actor.id)
          : '';

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

      const roleRecords = Object.create(null);
      for (const request of requests) {
        if (!request.roleAuthorization) continue;
        if (!actorId) {
          throw new Error(
            'Declarative Bridge authorization requires a stable host user ID.'
          );
        }
        const authorization = request.roleAuthorization;
        const cacheKey = [
          authorization.model,
          authorization.primaryKey,
          authorization.roleAttribute
        ].join(':');
        if (Object.prototype.hasOwnProperty.call(roleRecords, cacheKey)) {
          continue;
        }
        const model = sails.models[authorization.model];
        if (!model || typeof model.findOne !== 'function') {
          throw new Error(
            'Configured Bridge authorization model "' +
              authorization.model +
              '" is unavailable.'
          );
        }
        roleRecords[cacheKey] = await model.findOne({
          [authorization.primaryKey]: actorId
        });
      }

      for (const request of requests) {
        if (request.roleAuthorization) {
          const authorization = request.roleAuthorization;
          const cacheKey = [
            authorization.model,
            authorization.primaryKey,
            authorization.roleAttribute
          ].join(':');
          const record = roleRecords[cacheKey];
          const role = record
            ? String(record[authorization.roleAttribute] || '')
            : '';
          const allowedActions = Object.prototype.hasOwnProperty.call(
            authorization.roles,
            role
          )
            ? authorization.roles[role]
            : [];
          decisions[request.key] = decisions[request.key] || {};
          decisions[request.key][request.action] =
            allowedActions.includes('*') ||
            allowedActions.includes(request.action);
          continue;
        }

        const helper = resolveHelper(request.helperIdentity);
        const inputs = {
          actor,
          action: request.action,
          resource: request.resource
        };
        if (
          recordId !== undefined &&
          recordId !== null &&
          (
            request.scope === 'record' ||
            ['view', 'update', 'delete'].includes(request.action)
          )
        ) {
          inputs.recordId = recordId;
        }
        if (
          Array.isArray(recordIds) &&
          (
            request.scope === 'bulk' ||
            request.action === 'bulkDelete'
          )
        ) {
          inputs.recordIds = recordIds;
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
    removeDeniedDefinitions(effectiveResources)

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

function removeDeniedDefinitions(resources) {
  for (const resource of Object.values(resources)) {
    for (const action of Object.keys(resource.actionDefinitions || {})) {
      if (resource.actions?.[action] !== true) {
        delete resource.actionDefinitions[action]
      }
    }
  }
}
