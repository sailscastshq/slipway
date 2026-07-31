const crypto = require('crypto')

module.exports = {
  friendlyName: 'Fingerprint runtime configuration',

  description:
    'Create a keyed fingerprint and value-free manifest for resolved runtime configuration.',

  sync: true,

  inputs: {
    values: { type: 'ref', required: true },
    manifest: { type: 'ref', defaultsTo: [] }
  },

  exits: {
    success: { outputType: 'ref' }
  },

  fn: function ({ values, manifest }) {
    const metadata = new Map(
      (manifest || []).map((entry) => [entry.key, sanitize(entry)])
    )
    for (const key of Object.keys(values || {})) {
      if (!metadata.has(key)) {
        metadata.set(key, {
          key,
          scope: 'platform',
          kind: 'secret',
          managed: true,
          previewPolicy: 'omit'
        })
      }
    }

    const sortedValues = Object.keys(values || {})
      .sort()
      .map((key) => [key, values[key]])
    const key = sails.config.models.dataEncryptionKeys.default
    const hash = crypto
      .createHmac('sha256', key)
      .update(JSON.stringify(sortedValues))
      .digest('hex')

    return {
      hash,
      manifest: [...metadata.values()].sort((a, b) =>
        a.key.localeCompare(b.key)
      )
    }
  }
}

function sanitize(entry) {
  return {
    key: String(entry.key),
    scope: ['global', 'environment', 'app', 'platform'].includes(entry.scope)
      ? entry.scope
      : 'platform',
    kind: entry.kind === 'plain' ? 'plain' : 'secret',
    managed: entry.managed === true,
    previewPolicy: ['inherit', 'omit', 'randomize'].includes(
      entry.previewPolicy
    )
      ? entry.previewPolicy
      : 'omit'
  }
}
