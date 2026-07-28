const crypto = require('crypto')

module.exports = {
  friendlyName: 'Activate Bridge invitation',

  description:
    'Atomically bind one unexpired Bridge invitation to a verified host-app identity.',

  inputs: {
    accessId: {
      type: 'string',
      required: true
    },
    inviteToken: {
      type: 'string',
      required: true
    },
    hostUserId: {
      type: 'string',
      required: true
    },
    hostUserName: {
      type: 'string',
      allowNull: true
    }
  },

  exits: {
    success: {
      outputType: 'ref'
    }
  },

  fn: async function ({ accessId, inviteToken, hostUserId, hostUserName }) {
    const tokenHash = crypto
      .createHash('sha256')
      .update(inviteToken)
      .digest('hex')
    const now = Date.now()
    const database = sails.getDatastore().manager
    const result = database
      .prepare(
        `
          UPDATE bridge_access
          SET status = 'active',
              host_user_id = ?,
              host_user_name = ?,
              activated_at = ?,
              last_used_at = ?,
              invite_token_hash = NULL,
              invite_expires_at = NULL,
              updated_at = ?
          WHERE id = ?
            AND status = 'pending'
            AND invite_token_hash = ?
            AND invite_expires_at > ?
        `
      )
      .run(hostUserId, hostUserName, now, now, now, accessId, tokenHash, now)

    if (result.changes !== 1) return null
    return BridgeAccess.findOne({ id: accessId })
  }
}
