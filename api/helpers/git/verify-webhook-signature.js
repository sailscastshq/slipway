const crypto = require('crypto')

module.exports = {
  friendlyName: 'Verify Webhook Signature',

  description: 'Verify GitHub webhook HMAC-SHA256 signature.',

  inputs: {
    payload: { type: 'ref' },
    signature: { type: 'string' },
    secret: { type: 'string' }
  },

  fn: async function ({ payload, signature, secret }) {
    if (
      !Buffer.isBuffer(payload) ||
      !secret ||
      !/^sha256=[a-f0-9]{64}$/.test(signature || '')
    )
      return false

    const expectedSignature =
      'sha256=' +
      crypto.createHmac('sha256', secret).update(payload).digest('hex')

    // Constant-time comparison to prevent timing attacks
    try {
      return crypto.timingSafeEqual(
        Buffer.from(signature),
        Buffer.from(expectedSignature)
      )
    } catch {
      return false
    }
  }
}
