module.exports = {
  friendlyName: 'Consume Bearing launch code',

  description:
    'Atomically consume one unexpired Bearing launch code and return its record.',

  inputs: {
    tokenHash: { type: 'string', required: true }
  },

  exits: {
    success: { outputType: 'ref' }
  },

  fn: async function ({ tokenHash }) {
    const now = Date.now()
    const database = sails.getDatastore().manager
    const result = database
      .prepare(
        `
          UPDATE bearing_launch_codes
          SET used_at = ?, updated_at = ?
          WHERE token_hash = ?
            AND used_at IS NULL
            AND expires_at > ?
        `
      )
      .run(now, now, tokenHash, now)

    if (result.changes !== 1) return null
    return BearingLaunchCode.findOne({ tokenHash })
  }
}
