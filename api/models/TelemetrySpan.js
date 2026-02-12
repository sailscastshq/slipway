/**
 * TelemetrySpan.js
 *
 * Represents an HTTP request lifecycle span collected from deployed apps.
 * Spans are sent by sails-hook-slipway and ingested via the telemetry endpoint.
 * Pruned after 7 days by the Lookout hook.
 */

module.exports = {
  tableName: 'telemetry_spans',

  attributes: {
    traceId: {
      type: 'string',
      required: true,
      description: 'Unique trace identifier',
      columnName: 'trace_id'
    },

    spanId: {
      type: 'string',
      required: true,
      description: 'Unique span identifier',
      columnName: 'span_id'
    },

    parentSpanId: {
      type: 'string',
      allowNull: true,
      description: 'Parent span ID for nested spans',
      columnName: 'parent_span_id'
    },

    name: {
      type: 'string',
      required: true,
      description: 'Span name, e.g. "GET /api/users"'
    },

    kind: {
      type: 'string',
      isIn: ['server', 'client', 'internal'],
      defaultsTo: 'server',
      description: 'Span kind'
    },

    method: {
      type: 'string',
      allowNull: true,
      description: 'HTTP method'
    },

    url: {
      type: 'string',
      allowNull: true,
      description: 'Request URL path'
    },

    statusCode: {
      type: 'number',
      allowNull: true,
      description: 'HTTP response status code',
      columnName: 'status_code'
    },

    duration: {
      type: 'number',
      required: true,
      description: 'Duration in milliseconds'
    },

    startedAt: {
      type: 'number',
      required: true,
      description: 'Timestamp when the span started',
      columnName: 'started_at'
    },

    attributes: {
      type: 'json',
      defaultsTo: {},
      description: 'Additional key-value attributes'
    },

    // Associations
    environment: {
      model: 'environment',
      required: true
    }
  }
}
