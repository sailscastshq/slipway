/**
 * BearingLaunchCode.js
 *
 * Short-lived, single-use handoff from a host-app session into Bearing.
 */

module.exports = {
  tableName: 'bearing_launch_codes',

  attributes: {
    tokenHash: {
      type: 'string',
      required: true,
      unique: true,
      columnName: 'token_hash'
    },

    expiresAt: {
      type: 'number',
      required: true,
      columnName: 'expires_at'
    },

    usedAt: {
      type: 'number',
      allowNull: true,
      columnName: 'used_at'
    },

    participant: {
      model: 'bearingparticipant',
      required: true
    },

    app: {
      model: 'app',
      required: true
    }
  }
}
