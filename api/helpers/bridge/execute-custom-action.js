module.exports = {
  friendlyName: 'Execute Bridge custom action',

  description:
    'Run a configured Bridge action helper inside the target Sails application.',

  inputs: {
    containerName: {
      type: 'string',
      required: true
    },
    resource: {
      type: 'ref',
      required: true
    },
    action: {
      type: 'ref',
      required: true
    },
    actor: {
      type: 'ref',
      required: true
    },
    values: {
      type: 'ref',
      defaultsTo: {}
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
    resource,
    action,
    actor,
    values,
    recordId,
    recordIds
  }) {
    if (!isSafeHelperIdentity(action?.helper)) {
      throw bridgeActionError(
        'Configured Bridge action helper is invalid.',
        'BRIDGE_ACTION_INVALID'
      )
    }

    const actionCode = `
      const helperIdentity = ${JSON.stringify(action.helper)};
      const inputs = {
        actor: ${JSON.stringify(actor)},
        resource: ${JSON.stringify({
          identity: resource.identity,
          primaryKey: resource.primaryKey,
          label: resource.label,
          singularLabel: resource.singularLabel
        })},
        values: ${JSON.stringify(values)}
      };
      const recordId = ${JSON.stringify(recordId)};
      const recordIds = ${JSON.stringify(recordIds)};

      let helper = sails.helpers;
      for (const segment of helperIdentity.split('.')) {
        helper = helper && helper[segment];
      }
      if (!helper || typeof helper.with !== 'function') {
        throw new Error(
          'Configured Bridge action helper "' +
            helperIdentity +
            '" is unavailable.'
        );
      }

      if (recordId !== undefined && recordId !== null) {
        inputs.recordId = recordId;
      }
      if (Array.isArray(recordIds)) {
        inputs.recordIds = recordIds;
      }

      const result = await helper.with(inputs);
      if (result === undefined || result === null) return {};
      if (typeof result === 'string') return { message: result };
      if (typeof result !== 'object' || Array.isArray(result)) return {};
      return {
        message:
          typeof result.message === 'string'
            ? result.message
            : undefined
      };
    `
    const wrappedCode = await sails.helpers.bridge.buildSailsWrapper(actionCode)
    const result = await sails.helpers.bridge.executeInContainer(
      containerName,
      wrappedCode
    )

    if (!result.success) {
      throw bridgeActionError(
        result.error || `${action.label || action.name} failed.`,
        'BRIDGE_ACTION_EXECUTION_FAILED'
      )
    }

    let output
    try {
      output = result.output ? JSON.parse(result.output) : {}
    } catch {
      throw bridgeActionError(
        'The target app returned an invalid Bridge action result.',
        'BRIDGE_ACTION_EXECUTION_FAILED'
      )
    }

    return {
      message: safeMessage(output?.message) || action.success
    }
  }
}

function safeMessage(value) {
  if (typeof value !== 'string') return null
  const message = value.replace(/\s+/g, ' ').trim()
  return message ? message.slice(0, 500) : null
}

function bridgeActionError(message, code) {
  const error = new Error(message)
  error.code = code
  return error
}

function isSafeHelperIdentity(value) {
  return (
    typeof value === 'string' &&
    value
      .split('.')
      .every(
        (part) =>
          /^[A-Za-z][A-Za-z0-9]*$/.test(part) &&
          !['__proto__', 'constructor', 'prototype'].includes(part)
      )
  )
}
