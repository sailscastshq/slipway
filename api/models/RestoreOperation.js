module.exports = {
  tableName: 'restore_operations',
  attributes: {
    backup: { model: 'backup', required: true, columnName: 'backup_id' },
    service: { model: 'service', required: true, columnName: 'service_id' },
    team: { model: 'team', required: true, columnName: 'team_id' },
    requestedBy: { model: 'user', columnName: 'requested_by' },
    status: {
      type: 'string',
      isIn: ['queued', 'running', 'completed', 'failed', 'interrupted'],
      defaultsTo: 'queued'
    },
    stage: { type: 'string', defaultsTo: 'queued' },
    snapshotId: { type: 'number', allowNull: true, columnName: 'snapshot_id' },
    error: { type: 'string', defaultsTo: '' },
    startedAt: { type: 'number', allowNull: true, columnName: 'started_at' },
    completedAt: { type: 'number', allowNull: true, columnName: 'completed_at' }
  }
}
