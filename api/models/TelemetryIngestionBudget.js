module.exports = {
  datastore: 'observability',
  tableName: 'telemetry_ingestion_budgets',
  attributes: {
    environment: { type: 'string', required: true, unique: true },
    windowStart: { type: 'number', defaultsTo: 0, columnName: 'window_start' },
    events: { type: 'number', defaultsTo: 0 },
    bytes: { type: 'number', defaultsTo: 0 },
    requests: { type: 'number', defaultsTo: 0 },
    rejectedEvents: {
      type: 'number',
      defaultsTo: 0,
      columnName: 'rejected_events'
    },
    rejectedRequests: {
      type: 'number',
      defaultsTo: 0,
      columnName: 'rejected_requests'
    }
  }
}
