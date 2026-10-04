/** Durable delivery receipts, separate from resource incident detection. */
module.exports = {
  datastore: 'observability',
  tableName: 'resource_alert_deliveries',
  attributes: {
    incidentKey: {
      type: 'string',
      required: true,
      unique: true,
      columnName: 'incident_key'
    },
    containerName: {
      type: 'string',
      required: true,
      columnName: 'container_name'
    },
    resource: { type: 'string', required: true, isIn: ['cpu', 'memory'] },
    observedAt: { type: 'number', required: true, columnName: 'observed_at' },
    payload: { type: 'json', required: true },
    receipts: { type: 'json', defaultsTo: {} },
    status: {
      type: 'string',
      defaultsTo: 'pending',
      isIn: ['pending', 'sent', 'recovered', 'expired']
    },
    attempts: { type: 'number', defaultsTo: 0 },
    nextAttemptAt: {
      type: 'number',
      defaultsTo: 0,
      columnName: 'next_attempt_at'
    },
    leaseUntil: { type: 'number', defaultsTo: 0, columnName: 'lease_until' },
    leaseOwner: { type: 'string', defaultsTo: '', columnName: 'lease_owner' },
    lastOutcome: {
      type: 'string',
      defaultsTo: 'queued',
      columnName: 'last_outcome'
    }
  }
}
