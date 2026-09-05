module.exports = {
  tableName: 'source_operations',
  attributes: {
    project: { model: 'project', required: true, columnName: 'project_id' },
    requestedBy: { model: 'user', columnName: 'requested_by' },
    status: {
      type: 'string',
      isIn: ['queued', 'running', 'completed', 'failed', 'cancelled'],
      defaultsTo: 'queued'
    },
    archivePath: { type: 'string', required: true, columnName: 'archive_path' },
    sourceRevision: {
      type: 'string',
      allowNull: true,
      columnName: 'source_revision'
    },
    error: { type: 'string', defaultsTo: '' },
    cancelRequested: {
      type: 'boolean',
      defaultsTo: false,
      columnName: 'cancel_requested'
    }
  }
}
