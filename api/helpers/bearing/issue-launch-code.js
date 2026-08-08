const crypto = require('node:crypto')

module.exports = {
  friendlyName: 'Issue Bearing launch code',

  description:
    'Create a short-lived, single-use code for a verified host-app participant.',

  inputs: {
    participantId: { type: 'string', required: true },
    appId: { type: 'string', required: true }
  },

  exits: {
    success: { outputType: 'string' }
  },

  fn: async function ({ participantId, appId }) {
    const token = `bnc_${crypto.randomBytes(32).toString('base64url')}`
    const tokenHash = crypto.createHash('sha256').update(token).digest('hex')
    const now = Date.now()

    await BearingLaunchCode.destroy({ expiresAt: { '<': now } })
    await BearingLaunchCode.create({
      tokenHash,
      expiresAt: now + 2 * 60 * 1000,
      participant: participantId,
      app: appId
    })

    return token
  }
}
