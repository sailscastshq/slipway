module.exports = {
  friendlyName: 'Normalize environment variable metadata',

  description:
    'Build safe metadata for a variable map while preserving server-owned fields.',

  sync: true,

  inputs: {
    values: { type: 'ref', required: true },
    metadata: { type: 'ref', defaultsTo: {} },
    currentValues: { type: 'ref', defaultsTo: {} },
    currentMetadata: { type: 'ref', defaultsTo: {} },
    managedKeys: { type: 'ref', defaultsTo: [] },
    changedBy: { type: 'string', allowNull: true },
    changedByName: { type: 'string', allowNull: true },
    now: { type: 'number', defaultsTo: 0 },
    recordChanges: {
      type: 'boolean',
      defaultsTo: true,
      description:
        'Whether policy defaulting may create per-variable change history.'
    }
  },

  exits: {
    success: { outputType: 'ref' }
  },

  fn: function ({
    values,
    metadata,
    currentValues,
    currentMetadata,
    managedKeys,
    changedBy,
    changedByName,
    now,
    recordChanges
  }) {
    const normalized = {}
    const managed = new Set((managedKeys || []).map(String))
    const changedAt = now || Date.now()

    for (const key of Object.keys(values || {})) {
      const previous = currentMetadata?.[key] || {}
      const requested = metadata?.[key] || {}
      const kind = allowed(requested.kind, ['secret', 'plain'])
        ? requested.kind
        : allowed(previous.kind, ['secret', 'plain'])
        ? previous.kind
        : 'secret'
      const previewPolicy = allowed(requested.previewPolicy, [
        'inherit',
        'omit',
        'randomize'
      ])
        ? requested.previewPolicy
        : allowed(previous.previewPolicy, ['inherit', 'omit', 'randomize'])
        ? previous.previewPolicy
        : kind === 'secret'
        ? 'omit'
        : 'inherit'
      const description = String(
        requested.description ?? previous.description ?? ''
      )
        .trim()
        .slice(0, 160)
      const next = {
        kind,
        managed: managed.has(key) || previous.managed === true,
        previewPolicy
      }
      if (description) next.description = description

      if (!recordChanges) {
        preserveHistory(next, previous)
        normalized[key] = next
        continue
      }

      const changed =
        !Object.prototype.hasOwnProperty.call(currentValues || {}, key) ||
        currentValues[key] !== values[key] ||
        previous.kind !== next.kind ||
        previous.managed !== next.managed ||
        previous.previewPolicy !== next.previewPolicy ||
        String(previous.description || '') !== description

      if (changed) {
        next.changedAt = changedAt
        next.changedBy = changedBy || null
        next.changedByName = changedByName || null
      } else {
        preserveHistory(next, previous)
      }
      normalized[key] = next
    }

    return normalized
  }
}

function allowed(value, values) {
  return values.includes(value)
}

function preserveHistory(target, source) {
  for (const field of ['changedAt', 'changedBy', 'changedByName']) {
    if (source[field] !== undefined) target[field] = source[field]
  }
}
