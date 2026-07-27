module.exports = {
  friendlyName: 'Allow Bridge action values',

  description:
    'Apply Bridge field validation to the typed values submitted for a custom action.',

  inputs: {
    values: {
      type: 'ref',
      defaultsTo: {}
    },
    resource: {
      type: 'ref',
      required: true
    },
    action: {
      type: 'ref',
      required: true
    }
  },

  exits: {
    success: {
      outputType: 'ref'
    }
  },

  fn: async function ({ values, resource, action }) {
    if (
      !action ||
      typeof action !== 'object' ||
      Array.isArray(action) ||
      !action.name ||
      !action.fields
    ) {
      const error = new Error('Bridge action definition is invalid.')
      error.code = 'BRIDGE_ACTION_INVALID'
      throw error
    }
    if (
      !values ||
      typeof values !== 'object' ||
      Array.isArray(values) ||
      ![Object.prototype, null].includes(Object.getPrototypeOf(values))
    ) {
      const error = new Error('Action values must be a plain object.')
      error.code = 'INVALID_BRIDGE_VALUES'
      throw error
    }

    const submittedValues = {
      ...defaultValues(action.fields),
      ...values
    }

    return sails.helpers.bridge.allowResourceValues.with({
      values: submittedValues,
      resource: {
        identity: `${resource.identity}.${action.name}`,
        primaryKey: '__bridgeActionPrimaryKey',
        create: Object.keys(action.fields),
        attributes: action.fields,
        associations: []
      },
      surface: 'create'
    })
  }
}

function defaultValues(fields) {
  const values = {}
  for (const [name, attribute] of Object.entries(fields || {})) {
    if (attribute?.field?.default !== undefined) {
      values[name] = clone(attribute.field.default)
    }
  }
  return values
}

function clone(value) {
  return value === undefined ? undefined : JSON.parse(JSON.stringify(value))
}
