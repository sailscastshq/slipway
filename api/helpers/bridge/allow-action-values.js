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

    const drivers = [
      ...new Set(
        Object.values(action.fields).flatMap((attribute) =>
          Object.keys(attribute.visibleWhen || {})
            .filter((path) => path.startsWith('form.'))
            .map((path) => path.slice(5))
        )
      )
    ]
    let typedDrivers = {}
    if (drivers.length) {
      typedDrivers = await sails.helpers.bridge.allowResourceValues.with({
        values: Object.fromEntries(
          drivers
            .filter((name) => Object.hasOwn(submittedValues, name))
            .map((name) => [name, submittedValues[name]])
        ),
        resource: {
          identity: `${resource.identity}.${action.name}`,
          primaryKey: '__bridgeActionPrimaryKey',
          create: drivers,
          attributes: action.fields,
          associations: []
        },
        surface: 'create'
      })
    }
    const visibleFields = Object.fromEntries(
      Object.entries(action.fields).filter(([, attribute]) =>
        sails.helpers.bridge.matchesActionConditions.with({
          condition: attribute.visibleWhen,
          form: typedDrivers,
          scope: 'form'
        })
      )
    )
    const visibleValues = Object.fromEntries(
      Object.entries(submittedValues).filter(
        ([name]) => !action.fields[name] || Object.hasOwn(visibleFields, name)
      )
    )
    return sails.helpers.bridge.allowResourceValues.with({
      values: visibleValues,
      resource: {
        identity: `${resource.identity}.${action.name}`,
        primaryKey: '__bridgeActionPrimaryKey',
        create: Object.keys(visibleFields),
        attributes: visibleFields,
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
