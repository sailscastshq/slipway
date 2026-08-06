module.exports = {
  friendlyName: 'Resolve Bridge relationship scope',

  description:
    'Resolve a normalized relationship where contract using declared sibling field values only.',

  inputs: {
    resource: {
      type: 'ref',
      required: true
    },
    relationship: {
      type: 'ref',
      required: true
    },
    values: {
      type: 'ref',
      defaultsTo: {}
    }
  },

  exits: {
    success: {
      outputType: 'ref'
    }
  },

  fn: async function ({ resource, relationship, values }) {
    const safeValues =
      values && typeof values === 'object' && !Array.isArray(values)
        ? values
        : {}
    const where = {}
    const missing = []

    for (const [targetField, constraint] of Object.entries(
      relationship.where || {}
    )) {
      if (!isFromFieldConstraint(constraint)) {
        where[targetField] = constraint
        continue
      }

      const sourceField = constraint.fromField
      const value = safeValues[sourceField]
      if (value === undefined || value === null || value === '') {
        missing.push(sourceField)
        continue
      }

      const attribute = resource.attributes?.[sourceField] || {}
      where[targetField] = await normalizeValue({
        value,
        attribute,
        label: resource.attributes?.[sourceField]?.label || sourceField
      })
    }

    return {
      ready: missing.length === 0,
      missing,
      where
    }
  }
}

function isFromFieldConstraint(value) {
  return Boolean(
    value &&
      typeof value === 'object' &&
      !Array.isArray(value) &&
      typeof value.fromField === 'string'
  )
}

async function normalizeValue({ value, attribute, label }) {
  if (attribute.type === 'boolean') {
    if (value === true || value === false) return value
    if (value === 'true') return true
    if (value === 'false') return false
    throw invalid(`${label} must be true or false.`)
  }

  try {
    return await sails.helpers.bridge.normalizeIdentifier.with({
      value,
      attribute,
      label
    })
  } catch (cause) {
    const error = invalid(cause.message)
    error.cause = cause
    throw error
  }
}

function invalid(message) {
  const error = new Error(message)
  error.code = 'BRIDGE_RELATIONSHIP_SCOPE_INVALID'
  return error
}
