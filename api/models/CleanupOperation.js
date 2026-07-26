/**
 * CleanupOperation.js
 *
 * Durable, resumable state for destructive resource cleanup.
 */

module.exports = {
  tableName: 'cleanup_operations',

  attributes: {
    targetKey: {
      type: 'string',
      required: true,
      unique: true,
      columnName: 'target_key',
      description: 'Stable identity used to resume the same cleanup request.'
    },

    requestKey: {
      type: 'string',
      required: true,
      columnName: 'request_key',
      description:
        'Route-level identity used to find the latest operation after its target record is gone.'
    },

    scopeType: {
      type: 'string',
      required: true,
      isIn: ['project', 'environment', 'app', 'service'],
      columnName: 'scope_type'
    },

    resourceId: {
      type: 'number',
      required: true,
      columnName: 'resource_id'
    },

    projectId: {
      type: 'number',
      allowNull: true,
      columnName: 'project_id'
    },

    environmentId: {
      type: 'number',
      allowNull: true,
      columnName: 'environment_id'
    },

    appId: {
      type: 'number',
      allowNull: true,
      columnName: 'app_id'
    },

    serviceId: {
      type: 'number',
      allowNull: true,
      columnName: 'service_id'
    },

    retentionPolicy: {
      type: 'string',
      isIn: ['retain', 'purge'],
      defaultsTo: 'retain',
      columnName: 'retention_policy'
    },

    status: {
      type: 'string',
      isIn: ['pending', 'running', 'failed', 'complete'],
      defaultsTo: 'pending'
    },

    stage: {
      type: 'string',
      defaultsTo: 'pending'
    },

    snapshot: {
      type: 'json',
      defaultsTo: {},
      description:
        'Immutable resource and artifact inventory captured before deletion.'
    },

    stages: {
      type: 'json',
      defaultsTo: {},
      description: 'Outcome of each idempotent cleanup stage.'
    },

    warnings: {
      type: 'json',
      defaultsTo: []
    },

    errorMessage: {
      type: 'string',
      allowNull: true,
      columnName: 'error_message'
    },

    completedAt: {
      type: 'number',
      allowNull: true,
      columnName: 'completed_at'
    },

    requestedBy: {
      model: 'user',
      columnName: 'requested_by'
    },

    team: {
      model: 'team',
      required: true
    },

    ipAddress: {
      type: 'string',
      allowNull: true,
      columnName: 'ip_address'
    }
  }
}
