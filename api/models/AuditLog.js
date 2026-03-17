/**
 * AuditLog.js
 *
 * Tracks important actions performed in the system for security
 * and compliance auditing.
 */

module.exports = {
  tableName: 'audit_logs',

  attributes: {
    action: {
      type: 'string',
      required: true,
      description:
        'Action performed (e.g. deployment.triggered, service.created)',
      example: 'deployment.triggered'
    },

    resourceType: {
      type: 'string',
      required: true,
      description: 'Type of resource acted upon',
      columnName: 'resource_type'
    },

    resourceId: {
      type: 'string',
      allowNull: true,
      description: 'ID of the resource acted upon',
      columnName: 'resource_id'
    },

    details: {
      type: 'json',
      defaultsTo: {},
      description: 'Additional context about the action'
    },

    ipAddress: {
      type: 'string',
      allowNull: true,
      description: 'IP address of the request',
      columnName: 'ip_address'
    },

    // Associations
    user: {
      model: 'user',
      description: 'User who performed the action'
    },

    team: {
      model: 'team',
      description: 'Team context for the action'
    }
  }
}
