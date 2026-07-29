/**
 * HelmWriteArm.js
 *
 * A short-lived, single-use server capability for an exact production Helm
 * source and execution target. Only a SHA-256 token digest is persisted.
 */

module.exports = {
  tableName: 'helm_write_arms',

  attributes: {
    tokenHash: {
      type: 'string',
      required: true,
      unique: true,
      columnName: 'token_hash'
    },

    sourceHash: {
      type: 'string',
      required: true,
      columnName: 'source_hash'
    },

    targetFingerprint: {
      type: 'string',
      required: true,
      columnName: 'target_fingerprint'
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

    user: {
      model: 'user',
      required: true
    },

    team: {
      model: 'team',
      required: true
    },

    project: {
      model: 'project',
      required: true
    },

    environment: {
      model: 'environment',
      required: true
    },

    app: {
      model: 'app',
      required: true
    }
  }
}
