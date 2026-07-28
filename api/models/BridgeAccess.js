/**
 * BridgeAccess.js
 *
 * App-scoped invitations and grants for host-app users. Bridge users are not
 * Slipway team members and never inherit infrastructure permissions.
 */

module.exports = {
  tableName: 'bridge_access',

  attributes: {
    email: {
      type: 'string',
      required: true,
      isEmail: true,
      maxLength: 200
    },

    role: {
      type: 'string',
      isIn: ['viewer', 'editor', 'administrator'],
      defaultsTo: 'viewer'
    },

    status: {
      type: 'string',
      isIn: ['pending', 'active', 'revoked'],
      defaultsTo: 'pending'
    },

    hostUserId: {
      type: 'string',
      allowNull: true,
      columnName: 'host_user_id'
    },

    hostUserName: {
      type: 'string',
      allowNull: true,
      columnName: 'host_user_name'
    },

    activatedAt: {
      type: 'number',
      allowNull: true,
      columnName: 'activated_at'
    },

    lastUsedAt: {
      type: 'number',
      allowNull: true,
      columnName: 'last_used_at'
    },

    revokedAt: {
      type: 'number',
      allowNull: true,
      columnName: 'revoked_at'
    },

    inviteTokenHash: {
      type: 'string',
      allowNull: true,
      columnName: 'invite_token_hash'
    },

    inviteExpiresAt: {
      type: 'number',
      allowNull: true,
      columnName: 'invite_expires_at'
    },

    app: {
      model: 'app',
      required: true
    },

    environment: {
      model: 'environment',
      required: true
    },

    project: {
      model: 'project',
      required: true
    },

    team: {
      model: 'team',
      required: true
    },

    invitedBy: {
      model: 'user',
      required: true,
      columnName: 'invited_by'
    },

    revokedBy: {
      model: 'user',
      columnName: 'revoked_by'
    }
  },

  beforeCreate: async function (values, proceed) {
    values.email = values.email.trim().toLowerCase()
    return proceed()
  },

  beforeUpdate: async function (values, proceed) {
    if (values.email) {
      values.email = values.email.trim().toLowerCase()
    }
    return proceed()
  }
}
