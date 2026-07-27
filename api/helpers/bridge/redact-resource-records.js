module.exports = {
  friendlyName: 'Redact Bridge resource records',

  description:
    'Strip record properties that are outside the normalized Bridge field surface.',

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
          safeRecord[field] = record[field]
        }
      }
      return safeRecord
    }

    return Array.isArray(records) ? records.map(redact) : redact(records)
  }
}
