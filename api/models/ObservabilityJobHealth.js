/**
 * ObservabilityJobHealth.js
 *
 * Durable status for Lookout's collector and retention maintenance jobs.
 */

module.exports = {
  datastore: 'observability',
  tableName: 'observability_job_health',

  attributes: {
    jobName: {
      type: 'string',
      required: true,
      unique: true,
      columnName: 'job_name'
    },

    lastAttemptAt: {
      type: 'number',
      allowNull: true,
      columnName: 'last_attempt_at'
    },

    lastSuccessAt: {
      type: 'number',
      allowNull: true,
      columnName: 'last_success_at'
    },

    lastFailureAt: {
      type: 'number',
      allowNull: true,
      columnName: 'last_failure_at'
    },

    lastError: {
      type: 'string',
      allowNull: true,
      columnName: 'last_error'
    },

    lastDurationMs: {
      type: 'number',
      allowNull: true,
      columnName: 'last_duration_ms'
    },

    rowCount: {
      type: 'number',
      defaultsTo: 0,
      columnName: 'row_count'
    },

    details: {
      type: 'json',
      defaultsTo: {}
    }
  }
}
