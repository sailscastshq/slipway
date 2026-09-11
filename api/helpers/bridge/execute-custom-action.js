const conditions = require('../../lib/bridge-action-conditions')

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
    conditionState: { type: 'ref' },
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
    conditionState,
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
      try {
      const helperIdentity = ${JSON.stringify(action.helper)};
      const invocation = ${JSON.stringify(action.invocation || null)};
      const envelope = {
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
        envelope.recordId = recordId;
      }
      if (Array.isArray(recordIds)) {
        envelope.recordIds = recordIds;
      }

      const inputs =
        invocation && invocation.inputs === 'values'
          ? { ...envelope.values }
          : envelope;
      if (invocation && invocation.inputs === 'values') {
        for (const key of invocation.context || []) {
          if (Object.prototype.hasOwnProperty.call(envelope, key)) {
            inputs[key] = envelope[key];
          }
        }
      }

      ${
        conditionState
          ? `
      const conditionFields = ${JSON.stringify(conditionState.fields)};
      let current;
      try {
      current = await sails.models[${JSON.stringify(
        resource.identity
      )}].findOne(${JSON.stringify({
              [resource.primaryKey]: recordId
            })}).select([...conditionFields]);
      } catch (cause) {
        const error = new Error('Could not reload record conditions.', { cause });
        error.code = 'BRIDGE_ACTION_VALIDATION_FAILED';
        error.publicMessage = 'Could not load the record to check this action. Try again; nothing was sent.';
        throw error;
      }
      if (!current) {
        const error = new Error('Record disappeared before execution.');
        error.code = 'BRIDGE_ACTION_VALIDATION_FAILED';
        error.publicMessage = 'This record no longer exists. Nothing was sent.';
        throw error;
      }
      if (JSON.stringify(conditionFields.map(field => current[field])) !== ${JSON.stringify(
        JSON.stringify(conditionState.values)
      )}) {
        const error = new Error('Record conditions changed.');
        error.code = 'BRIDGE_ACTION_VALIDATION_FAILED';
        error.publicMessage = ${JSON.stringify(
          conditions.changedMessage(resource, conditionState.fields)
        )};
        throw error;
      }
      `
          : ''
      }
      const result = await helper.with(inputs);
      if (result === undefined || result === null) return {};
      if (invocation && invocation.result && invocation.result.message) {
        if (typeof result !== 'object' || Array.isArray(result)) {
          throw new Error('Configured Bridge action result must be an object.');
        }
        const message = invocation.result.message.replace(
          /{{\\s*([^{}]+?)\\s*}}/g,
          function (_placeholder, path) {
            let value = result;
            for (const segment of path.split('.')) {
              value = value && value[segment];
            }
            if (
              value === undefined ||
              value === null ||
              !['string', 'number', 'boolean'].includes(typeof value)
            ) {
              throw new Error(
                'Configured Bridge action result is missing "' + path + '".'
              );
            }
            return String(value);
          }
        );
        return { message };
      }
      if (typeof result === 'string') return { message: result };
      if (typeof result !== 'object' || Array.isArray(result)) return {};
      return {
        message:
          typeof result.message === 'string'
            ? result.message
            : undefined
      };
      } catch (error) {
        const source = error && error.raw || error || {};
        const validation = source.code === 'BRIDGE_ACTION_VALIDATION_FAILED';
        return { __slipwayActionFailure: {
          name: String(error && error.name || 'Error').slice(0, 100),
          code: String(source.code || 'BRIDGE_ACTION_EXECUTION_FAILED').slice(0, 100),
          diagnostic: String(error && (error.stack || error.message) || error).slice(0, 16000),
          publicMessage: validation && typeof source.publicMessage === 'string' ? source.publicMessage.slice(0, 500) : null,
          fieldErrors: validation && source.fieldErrors && typeof source.fieldErrors === 'object' ? Object.fromEntries(
            Object.entries(source.fieldErrors).filter(([key, value]) =>
              ${JSON.stringify(
                Object.keys(action.fields || {})
              )}.includes(key) && typeof value === 'string'
            ).map(([key, value]) => [key, value.slice(0, 500)])
          ) : {}
        } };
      }
    `
    const wrappedCode = await sails.helpers.bridge.buildSailsWrapper(actionCode)
    const result = await sails.helpers.bridge.executeInContainer(
      containerName,
      wrappedCode
    )

    if (!result.success) {
      const error = bridgeActionError(
        `${action.label || action.name} failed.`,
        'BRIDGE_ACTION_EXECUTION_FAILED'
      )
      error.diagnostic = {
        message: String(result.error || 'Worker failed.').slice(0, 16000),
        exitCode: result.exitCode
      }
      throw error
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

    if (output?.__slipwayActionFailure) {
      const failure = output.__slipwayActionFailure
      const error = bridgeActionError(
        safeMessage(failure.publicMessage) ||
          `${action.label || action.name} failed.`,
        'BRIDGE_ACTION_EXECUTION_FAILED'
      )
      error.fieldErrors = failure.fieldErrors || {}
      error.diagnostic = {
        name: failure.name,
        code: failure.code,
        message: failure.diagnostic
      }
      throw error
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
