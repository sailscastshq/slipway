/**
 * Backup.js
 *
 * Represents a database backup for a service.
 * Backups are stored in S3-compatible storage (R2, S3, Spaces, etc.).
 */

module.exports = {
  tableName: 'backups',

  attributes: {
    status: {
      type: 'string',
      isIn: ['pending', 'running', 'completed', 'failed'],
      defaultsTo: 'pending',
      description: 'Current status of the backup'
    },

    type: {
      type: 'string',
      isIn: ['manual', 'scheduled'],
      defaultsTo: 'manual',
      description: 'How this backup was triggered'
    },

    s3Key: {
      type: 'string',
      allowNull: true,
      description: 'Storage path in S3 bucket',
      columnName: 's3_key'
    },

    sizeBytes: {
      type: 'number',
      allowNull: true,
      description: 'Backup file size in bytes',
      columnName: 'size_bytes'
    },

    durationMs: {
      type: 'number',
      allowNull: true,
      description: 'Time taken for the backup in milliseconds',
      columnName: 'duration_ms'
    },

    errorMessage: {
      type: 'string',
      allowNull: true,
      description: 'Error message if backup failed',
      columnName: 'error_message'
    },

    startedAt: {
      type: 'number',
      allowNull: true,
      description: 'Timestamp when backup started',
      columnName: 'started_at'
    },

    completedAt: {
      type: 'number',
      allowNull: true,
      description: 'Timestamp when backup completed',
      columnName: 'completed_at'
    },

    // Associations
    service: {
      model: 'service',
      required: true
    },

    triggeredBy: {
      model: 'user',
      description: 'User who triggered the backup',
      columnName: 'triggered_by'
    }
  }
}
