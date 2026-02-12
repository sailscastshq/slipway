const crypto = require('crypto')

module.exports = {
  friendlyName: 'Verify Webhook Signature',

  description: 'Verify GitHub webhook HMAC-SHA256 signature.',

  inputs: {
    payload: {
      type: 'string',
      required: true,
      description: 'Raw request body as string'
    },
    signature: {
      type: 'string',
      required: true,
      description: 'X-Hub-Signature-256 header value'
    },
    secret: {
      type: 'string',
      required: true,
      description: 'Webhook secret'
    }
  },

  fn: async function ({ payload, signature, secret }) {
    if (!signature || !signature.startsWith('sha256=')) {
      return false
    }

    const expectedSignature = 'sha256=' + crypto
      .createHmac('sha256', secret)
      .update(payload)
      .digest('hex')

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
