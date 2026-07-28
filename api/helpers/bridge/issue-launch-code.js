const crypto = require('crypto')

module.exports = {
  friendlyName: 'Issue Bridge launch code',

  description:
    'Create a short-lived, single-use code for a verified host-app identity.',

  inputs: {
    accessId: {
      type: 'string',
      required: true
    },
    appId: {
      type: 'string',
      required: true
    }
  },

  exits: {
    success: {
      outputType: 'string'
    }
  },

  fn: async function ({ accessId, appId }) {
    const token = `blc_${crypto.randomBytes(32).toString('base64url')}`
    const tokenHash = crypto.createHash('sha256').update(token).digest('hex')
    const now = Date.now()

    await BridgeLaunchCode.destroy({
      expiresAt: { '<': now }
    })

    await BridgeLaunchCode.create({
      tokenHash,
      expiresAt: now + 2 * 60 * 1000,
      access: accessId,
      app: appId
    })

    return token
  }
}
