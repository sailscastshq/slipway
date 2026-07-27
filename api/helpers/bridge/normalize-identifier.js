module.exports = {
  friendlyName: 'Normalize Bridge identifier',

  description:
    'Normalize a Bridge record or association identifier using its Waterline attribute type.',

  inputs: {
    value: {
      type: 'ref',
      required: true
    },
    resource: {
      type: 'ref'
    },
    attribute: {
      type: 'ref'
    },
    allowNull: {
      type: 'boolean',
      defaultsTo: false
    },
    label: {
      type: 'string',
      defaultsTo: 'Bridge identifier'
    }
  },

  exits: {
    success: {
      outputType: 'ref'
    }
  },

  fn: async function ({ value, resource, attribute, allowNull, label }) {
    const identifierAttribute =
      attribute || resource?.attributes?.[resource?.primaryKey] || {}

    if (value === null || value === undefined || value === '') {
      if (allowNull) return null
      throw invalid(`${label} is required.`)
    }

    if (identifierAttribute.type === 'number') {
      const normalized =
        typeof value === 'number'
          ? value
          : typeof value === 'string' && value.trim() !== ''
          ? Number(value)
          : Number.NaN

      if (!Number.isFinite(normalized)) {
        throw invalid(`${label} must be a number.`)
      }
      return normalized
    }

    if (identifierAttribute.type === 'string') {
      if (typeof value !== 'string') {
        throw invalid(`${label} must be a string.`)
      }
      if (
        identifierAttribute.maxLength &&
        value.length > identifierAttribute.maxLength
      ) {
        throw invalid(
          `${label} must be at most ${identifierAttribute.maxLength} characters.`
        )
      }
      return value
    }

    if (!['string', 'number'].includes(typeof value)) {
      throw invalid(`${label} must be a string or number.`)
    }
    return value

    function invalid(message) {
      const error = new Error(message)
      error.code = 'BRIDGE_INVALID_IDENTIFIER'
      return error
    }
  }
}
