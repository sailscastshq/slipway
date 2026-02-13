/**
 * audit/log.js
 *
 * Creates an audit log entry. Designed to be a one-liner from controllers:
 * await sails.helpers.audit.log.with({ action: 'deployment.triggered', ... })
 */

module.exports = {
  friendlyName: 'Log audit event',

  description: 'Record an action in the audit log.',

  inputs: {
    action: {
      type: 'string',
      required: true,
      description: 'Action name (e.g. deployment.triggered)'
    },
    resourceType: {
      type: 'string',
      required: true,
      description: 'Resource type (e.g. deployment, service)'
    },
    resourceId: {
      type: 'string',
      description: 'ID of the resource'
    },
    details: {
      type: 'ref',
      defaultsTo: {},
      description: 'Additional context'
    },
    userId: {
      type: 'string',
      description: 'User who performed the action'
    },
    teamId: {
      type: 'string',
      description: 'Team context'
    },
    ipAddress: {
      type: 'string',
      description: 'Request IP address'
    }
  },

  fn: async function ({ action, resourceType, resourceId, details, userId, teamId, ipAddress }) {
    try {
      await AuditLog.create({
        action,
        resourceType,
        resourceId,
        details,
        ipAddress,
        user: userId || null,
        team: teamId || null
      })
    } catch (err) {
      // Audit logging should never break the main flow
      sails.log.verbose('Failed to write audit log:', err.message)
    }
  }
}
