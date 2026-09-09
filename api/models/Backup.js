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
      description: 'Legacy S3 object key; read through the compatibility path',
      columnName: 's3_key'
    },

    objectKey: { type: 'string', allowNull: true, columnName: 'object_key' },
    storage: {
      type: 'json',
      defaultsTo: {},
      description: 'Provider-neutral container, checksum, and upload metadata'
    },
    storageCredentials: {
      type: 'json',
      encrypt: true,
      protect: true,
      columnName: 'storage_credentials',
      description: 'Encrypted configuration bound to this backup'
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
