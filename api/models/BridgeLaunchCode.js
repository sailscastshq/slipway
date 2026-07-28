/**
 * BridgeLaunchCode.js
 *
 * Short-lived, single-use handoff from a host app session into Bridge.
 */

module.exports = {
  tableName: 'bridge_launch_codes',

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

    access: {
      model: 'bridgeaccess',
      required: true,
      columnName: 'access_id'
    },

    app: {
      model: 'app',
      required: true
    }
  }
}
