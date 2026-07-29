/**
 * HelmHistoryEntry.js
 *
 * Durable, user-scoped Helm execution metadata. Results and captured logs are
 * deliberately never persisted here.
 */

module.exports = {
  tableName: 'helm_history_entries',

  attributes: {
    source: {
      type: 'string',
      required: true,
      columnType: 'text'
    },

    status: {
      type: 'string',
      isIn: ['success', 'error', 'timeout', 'cancelled'],
      defaultsTo: 'error'
    },

    durationMs: {
      type: 'number',
      defaultsTo: 0,
      columnName: 'duration_ms'
    },

    executedAt: {
      type: 'number',
      required: true,
      columnName: 'executed_at'
    },

    target: {
      type: 'string',
      required: true,
      maxLength: 200
    },

    pinned: {
      type: 'boolean',
      defaultsTo: false
    },

    user: {
      model: 'user',
      required: true
    },

    team: {
      model: 'team',
      required: true
    },

    project: {
      model: 'project',
      required: true
    },

    environment: {
      model: 'environment',
      required: true
    },

    app: {
      model: 'app',
      required: true
    }
  }
}
