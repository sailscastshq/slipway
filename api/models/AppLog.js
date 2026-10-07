/**
 * AppLog.js
 *
 * Persists container log snapshots for historical viewing.
 * Collected every 5 minutes by the Lookout hook.
 * Pruned after 7 days.
 */

module.exports = {
  beforeCreate: redactDiagnostics,
  beforeUpdate: redactDiagnostics,

  datastore: 'observability',
  tableName: 'app_logs',

  attributes: {
    containerName: {
      type: 'string',
      required: true,
      description: 'Docker container name',
      columnName: 'container_name'
    },

    logs: {
      type: 'string',
      required: true,
      columnType: 'text',
      description: 'Log output captured from docker logs'
    },

    startedAt: {
      type: 'number',
      required: true,
      description: 'Timestamp of the log window start',
      columnName: 'started_at'
    },

    endedAt: {
      type: 'number',
      required: true,
      description: 'Timestamp of the log window end',
      columnName: 'ended_at'
    },

    lineCount: {
      type: 'number',
      defaultsTo: 0,
      description: 'Number of log lines captured',
      columnName: 'line_count'
    },

    app: {
      type: 'string',
      required: true,
      description: 'App ID (references App model in default datastore)'
    },

    environment: {
      type: 'string',
      required: true,
      description:
        'Environment ID (references Environment model in default datastore)'
    }
  }
}

function redactDiagnostics(values, proceed) {
  const redact = sails.hooks.secrets
  if (redact) {
    if (values.logs != null) values.logs = redact.protect(values.logs)
  }
  return proceed()
}
