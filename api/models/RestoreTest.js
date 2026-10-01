/** A rehearsal owns only disposable resources, never the live Service lifecycle. */
module.exports = {
  tableName: 'restore_tests',
  attributes: {
    backup: { model: 'backup', required: true },
    service: { model: 'service', required: true },
    team: { model: 'team', required: true },
    requestedBy: { model: 'user', columnName: 'requested_by' },
    status: {
      type: 'string',
      isIn: [
        'queued',
        'running',
        'completed',
        'failed',
        'cancelled',
        'interrupted'
      ],
      defaultsTo: 'queued'
    },
    stage: { type: 'string', defaultsTo: 'queued' },
    resourceName: {
      type: 'string',
      required: true,
      unique: true,
      columnName: 'resource_name'
    },
    report: { type: 'json', defaultsTo: {} },
    error: { type: 'string', defaultsTo: '' },
    cleanupPending: {
      type: 'boolean',
      defaultsTo: false,
      columnName: 'cleanup_pending'
    },
    startedAt: { type: 'number', allowNull: true, columnName: 'started_at' },
    completedAt: { type: 'number', allowNull: true, columnName: 'completed_at' }
  }
}
