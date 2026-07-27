module.exports = {
  friendlyName: 'Create Bridge record',

  description:
    'Create an allowlisted record inside a running target app container.',

  inputs: {
    containerName: {
      type: 'string',
      required: true
    },
    resource: {
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

  fn: async function ({ containerName, resource, values }) {
    const createResource = {
      primaryKey: resource.primaryKey,
      attributes: {
        [resource.primaryKey]: resource.attributes[resource.primaryKey]
      }
    }
    const createCode = `
      const identity = ${JSON.stringify(resource.identity)};
      const submittedValues = ${JSON.stringify(values)};
      const resource = ${JSON.stringify(createResource)};
      const model = sails.models[identity];
      if (!model) throw new Error('Configured Bridge model is unavailable.');

      const primaryKey = resource.primaryKey;
      const attribute = resource.attributes[primaryKey];
      const defaultValue = attribute?.field?.default;
      const values = { ...submittedValues };

      if (
        values[primaryKey] === undefined &&
        defaultValue &&
        typeof defaultValue === 'object' &&
        !Array.isArray(defaultValue) &&
        typeof defaultValue.helper === 'string'
      ) {
        let helper = sails.helpers;
        for (const segment of defaultValue.helper.split('.')) {
          if (
            !helper ||
            ['__proto__', 'constructor', 'prototype'].includes(segment) ||
            !Object.prototype.hasOwnProperty.call(helper, segment)
          ) {
            helper = null;
            break;
          }
          helper = helper[segment];
        }

        let generatedValue;
        if (helper && typeof helper.with === 'function') {
          generatedValue = await helper.with({});
        } else if (typeof helper === 'function') {
          generatedValue = await helper();
        } else {
          const error = new Error(
            'Bridge could not resolve the "' +
              defaultValue.helper +
              '" primary key helper.'
          );
          error.code = 'BRIDGE_PRIMARY_KEY_DEFAULT_FAILED';
          throw error;
        }

        if (generatedValue === undefined || generatedValue === null) {
          const error = new Error(
            'Bridge primary key helper "' +
              defaultValue.helper +
              '" returned no value.'
          );
          error.code = 'BRIDGE_PRIMARY_KEY_DEFAULT_FAILED';
          throw error;
        }

        values[primaryKey] =
          typeof model.validate === 'function'
            ? model.validate(primaryKey, generatedValue)
            : generatedValue;
      }

      const record = await model.create(values).fetch();
      return { record };
    `
    const wrappedCode = await sails.helpers.bridge.buildSailsWrapper(createCode)
    const result = await sails.helpers.bridge.executeInContainer(
      containerName,
      wrappedCode
    )

    if (!result.success) {
      const error = new Error(result.error || 'Failed to create record')
      error.code = 'BRIDGE_CREATE_FAILED'
      throw error
    }

    try {
      return JSON.parse(result.output).record
    } catch (cause) {
      const error = new Error('Failed to parse the created Bridge record.')
      error.code = 'BRIDGE_CREATE_FAILED'
      error.cause = cause
      throw error
    }
  }
}
