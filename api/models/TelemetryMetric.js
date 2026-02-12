/**
 * TelemetryMetric.js
 *
 * Stores custom application metrics from deployed apps — slow queries,
 * cache performance, queue throughput, etc.
 * Sent by sails-hook-slipway and ingested via the telemetry endpoint.
 * Pruned after 7 days by the Lookout hook.
 */

module.exports = {
  tableName: 'telemetry_metrics',

  attributes: {
    name: {
      type: 'string',
      required: true,
      description: 'Metric name, e.g. "db.query", "cache.hit", "http.request"'
    },

    value: {
      type: 'number',
      required: true,
      description: 'Metric value (e.g., duration in ms, count, bytes)'
    },

    unit: {
      type: 'string',
      defaultsTo: 'ms',
      description: 'Unit of measurement: ms, bytes, count, percent'
    },

    attributes: {
      type: 'json',
      defaultsTo: {},
      description: 'Additional context, e.g. { query: "SELECT ...", model: "User" }'
    },

    recordedAt: {
      type: 'number',
      required: true,
      description: 'Timestamp when this metric was recorded',
      columnName: 'recorded_at'
    },

    // Associations
    environment: {
      model: 'environment',
      required: true
    }
  }
}
