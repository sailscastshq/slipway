const crypto = require('crypto')

module.exports = {
  friendlyName: 'Apply preview configuration policy',

  description:
    'Prepare inherited configuration for a preview without blindly copying secrets.',

  sync: true,

  inputs: {
    values: { type: 'ref', required: true },
    metadata: { type: 'ref', defaultsTo: {} }
  },

  exits: {
    success: { outputType: 'ref' }
  },

  fn: function ({ values, metadata }) {
    const previewValues = {}
    const previewMetadata = {}

    for (const [key, value] of Object.entries(values || {})) {
      const entry = metadata?.[key] || {}
      const kind = entry.kind === 'plain' ? 'plain' : 'secret'
      const policy = ['inherit', 'omit', 'randomize'].includes(
        entry.previewPolicy
      )
        ? entry.previewPolicy
        : kind === 'secret'
        ? 'omit'
        : 'inherit'

      if (policy === 'omit') continue
      previewValues[key] =
        policy === 'randomize'
          ? crypto.randomBytes(32).toString('base64url')
          : value
      previewMetadata[key] = {
        ...entry,
        kind,
        previewPolicy: policy,
        managed: false,
        ...(policy === 'randomize'
          ? {
              changedAt: Date.now(),
              changedBy: null,
              changedByName: 'Slipway'
            }
          : {})
      }
    }

    return { values: previewValues, metadata: previewMetadata }
  }
}
