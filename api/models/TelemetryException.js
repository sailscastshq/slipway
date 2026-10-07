/**
 * TelemetryException.js
 *
 * Represents an error or exception captured from deployed apps.
 * Sent by sails-hook-slipway and ingested via the telemetry endpoint.
 * Pruned after 7 days by the Lookout hook.
 */

module.exports = {
  beforeCreate: redactDiagnostics,
  beforeUpdate: redactDiagnostics,

  datastore: 'observability',
  tableName: 'telemetry_exceptions',

  attributes: {
    exceptionType: {
      type: 'string',
      required: true,
      description: 'Error class name, e.g. "TypeError", "Error"',
      columnName: 'exception_type'
    },

    message: {
      type: 'string',
      required: true,
      description: 'Error message'
    },

    stackTrace: {
      type: 'string',
      allowNull: true,
      description: 'Full stack trace',
      columnName: 'stack_trace'
    },

    handled: {
      type: 'boolean',
      defaultsTo: false,
      description: 'Whether the exception was caught or unhandled'
    },

    method: {
      type: 'string',
      allowNull: true,
      description: 'HTTP method of the request that triggered the exception'
    },

    url: {
      type: 'string',
      allowNull: true,
      description: 'Request URL that triggered the exception'
    },

    traceId: {
      type: 'string',
      allowNull: true,
      description: 'Link to the request span',
      columnName: 'trace_id'
    },

    occurredAt: {
      type: 'number',
      required: true,
      description: 'Timestamp when the exception occurred',
      columnName: 'occurred_at'
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
    if (values.message != null) values.message = redact.protect(values.message)
    if (values.stackTrace != null)
      values.stackTrace = redact.protect(values.stackTrace)
    if (values.url != null) values.url = redact.protect(values.url)
  }
  return proceed()
}
