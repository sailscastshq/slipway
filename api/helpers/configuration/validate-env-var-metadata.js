module.exports = {
  friendlyName: 'Validate environment variable metadata',

  description: 'Validate client-editable config metadata without trusting it.',

  sync: true,

  inputs: {
    values: { type: 'ref', required: true },
    metadata: { type: 'ref', defaultsTo: {} }
  },

  exits: {
    success: { outputType: 'ref' }
  },

  fn: function ({ values, metadata }) {
    if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)) {
      return [
        { envVarMetadata: 'Variable metadata must be keyed by variable name.' }
      ]
    }

    for (const [key, entry] of Object.entries(metadata)) {
      if (!Object.prototype.hasOwnProperty.call(values || {}, key)) {
        return [
          { envVarMetadata: `Metadata references unknown variable "${key}".` }
        ]
      }
      if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
        return [{ envVarMetadata: `Metadata for "${key}" must be an object.` }]
      }
      if (entry.kind && !['secret', 'plain'].includes(entry.kind)) {
        return [
          { envVarMetadata: `Variable "${key}" has an invalid value type.` }
        ]
      }
      if (
        entry.previewPolicy &&
        !['inherit', 'omit', 'randomize'].includes(entry.previewPolicy)
      ) {
        return [
          { envVarMetadata: `Variable "${key}" has an invalid preview policy.` }
        ]
      }
      if (
        entry.description !== undefined &&
        (typeof entry.description !== 'string' ||
          entry.description.trim().length > 160)
      ) {
        return [
          {
            envVarMetadata: `Description for "${key}" must be 160 characters or fewer.`
          }
        ]
      }
    }

    return []
  }
}
