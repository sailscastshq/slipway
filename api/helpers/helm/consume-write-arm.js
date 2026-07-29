const crypto = require('node:crypto')

module.exports = {
  friendlyName: 'Consume Helm write arm',

  description:
    'Atomically consume one unexpired write arm bound to the exact actor, source, and production target.',

  inputs: {
    token: {
      type: 'string',
      required: true
    },
    scope: {
      type: 'ref',
      required: true
    },
    sourceHash: {
      type: 'string',
      required: true
    },
    targetFingerprint: {
      type: 'string',
      required: true
    }
  },

  fn: async function ({ token, scope, sourceHash, targetFingerprint }) {
    const tokenHash = crypto.createHash('sha256').update(token).digest('hex')
    const now = Date.now()
    const database = sails.getDatastore().manager
    const result = database
      .prepare(
        `
          UPDATE helm_write_arms
          SET used_at = ?, updated_at = ?
          WHERE token_hash = ?
            AND source_hash = ?
            AND target_fingerprint = ?
            AND user = ?
            AND team = ?
            AND project = ?
            AND environment = ?
            AND app = ?
            AND used_at IS NULL
            AND expires_at > ?
        `
      )
      .run(
        now,
        now,
        tokenHash,
        sourceHash,
        targetFingerprint,
        scope.user.id,
        scope.project.team.id,
        scope.project.id,
        scope.environment.id,
        scope.app.id,
        now
      )

    if (result.changes !== 1) return null
    return HelmWriteArm.findOne({ tokenHash })
  }
}
