const crypto = require('node:crypto')

/**
 * BearingParticipant.js
 *
 * A customer identity proven by the deployed host app. This is deliberately
 * not a Slipway User or BridgeAccess record.
 */

module.exports = {
  tableName: 'bearing_participants',

  attributes: {
    participantKey: {
      type: 'string',
      required: true,
      unique: true,
      protect: true,
      maxLength: 64,
      columnName: 'participant_key'
    },

    hostUserId: {
      type: 'string',
      required: true,
      protect: true,
      maxLength: 200,
      columnName: 'host_user_id'
    },

    displayName: {
      type: 'string',
      allowNull: true,
      maxLength: 200,
      columnName: 'display_name'
    },

    email: {
      type: 'string',
      required: true,
      isEmail: true,
      maxLength: 200,
      encrypt: true,
      protect: true
    },

    emailVerifiedAt: {
      type: 'number',
      required: true,
      columnName: 'email_verified_at'
    },

    firstSeenAt: {
      type: 'number',
      required: true,
      columnName: 'first_seen_at'
    },

    lastSeenAt: {
      type: 'number',
      required: true,
      columnName: 'last_seen_at'
    },

    disabledAt: {
      type: 'number',
      allowNull: true,
      columnName: 'disabled_at'
    },

    space: {
      model: 'bearingspace',
      required: true
    }
  },

  beforeCreate: async function (values, proceed) {
    values.hostUserId = String(values.hostUserId).trim()
    values.displayName = normalizeOptionalName(values.displayName)
    values.participantKey = participantKey(values.space, values.hostUserId)
    return proceed()
  },

  beforeUpdate: async function (values, proceed) {
    if (values.displayName !== undefined) {
      values.displayName = normalizeOptionalName(values.displayName)
    }
    return proceed()
  }
}

function participantKey(spaceId, hostUserId) {
  return crypto
    .createHash('sha256')
    .update(`${String(spaceId)}:${String(hostUserId)}`)
    .digest('hex')
}

function normalizeOptionalName(value) {
  const normalized = String(value || '').trim()
  return normalized ? normalized.slice(0, 200) : null
}
