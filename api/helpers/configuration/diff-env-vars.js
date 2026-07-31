module.exports = {
  friendlyName: 'Diff environment variables',

  description:
    'Describe configuration changes without returning or logging variable values.',

  sync: true,

  inputs: {
    before: { type: 'ref', defaultsTo: {} },
    after: { type: 'ref', defaultsTo: {} },
    beforeMetadata: { type: 'ref', defaultsTo: {} },
    afterMetadata: { type: 'ref', defaultsTo: {} }
  },

  exits: {
    success: { outputType: 'ref' }
  },

  fn: function ({ before, after, beforeMetadata, afterMetadata }) {
    const changes = []
    const keys = new Set([
      ...Object.keys(before || {}),
      ...Object.keys(after || {})
    ])

    for (const key of [...keys].sort()) {
      const existed = Object.prototype.hasOwnProperty.call(before || {}, key)
      const exists = Object.prototype.hasOwnProperty.call(after || {}, key)
      const previous = beforeMetadata?.[key] || {}
      const next = afterMetadata?.[key] || {}
      let operation

      if (!existed && exists) operation = 'created'
      else if (existed && !exists) operation = 'deleted'
      else if (before[key] !== after[key]) {
        operation =
          (next.kind || previous.kind) === 'secret' ? 'rotated' : 'updated'
      } else if (metadataChanged(previous, next)) operation = 'updated'
      else continue

      changes.push({
        key,
        operation,
        kind: next.kind || previous.kind || 'secret',
        managed: next.managed === true || previous.managed === true,
        previewPolicy: next.previewPolicy || previous.previewPolicy || 'omit'
      })
    }

    return changes
  }
}

function metadataChanged(before, after) {
  return ['kind', 'managed', 'previewPolicy', 'description'].some(
    (field) => (before?.[field] || '') !== (after?.[field] || '')
  )
}
