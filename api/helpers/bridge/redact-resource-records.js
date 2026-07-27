module.exports = {
  friendlyName: 'Redact Bridge resource records',

  description:
    'Strip unavailable properties and resolve stored field values for a Bridge surface.',

  inputs: {
    records: {
      type: 'ref',
      required: true
    },
    resource: {
      type: 'ref',
      required: true
    },
    surface: {
      type: 'string',
      required: true,
      isIn: ['list', 'show', 'edit']
    }
  },

  exits: {
    success: {
      outputType: 'ref'
    }
  },

  fn: async function ({ records, resource, surface }) {
    const allowedFields = new Set(resource[surface] || [])
    if (surface === 'edit' && resource.primaryKey) {
      allowedFields.add(resource.primaryKey)
    }

    const redact = (record) => {
      if (!record || typeof record !== 'object' || Array.isArray(record)) {
        return record
      }

      const safeRecord = {}
      for (const field of allowedFields) {
        if (
          !['__proto__', 'constructor', 'prototype'].includes(field) &&
          Object.prototype.hasOwnProperty.call(record, field)
        ) {
          safeRecord[field] = resolveFieldValue(
            record[field],
            resource.attributes?.[field]
          )
        }
      }
      return safeRecord
    }

    return Array.isArray(records) ? records.map(redact) : redact(records)
  }
}

function resolveFieldValue(value, attribute) {
  if (value === null || value === undefined) return value
  if (
    attribute?.field?.type === 'currency' &&
    attribute.field.currency?.storage === 'minor'
  ) {
    const number = Number(value)
    if (!Number.isFinite(number)) return value
    const digits = attribute.field.currency.maximumFractionDigits ?? 2
    return number / 10 ** digits
  }
  return value
}
