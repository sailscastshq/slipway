const crypto = require('node:crypto')

module.exports = {
  friendlyName: 'Verify Bridge direct upload intent',

  description:
    'Verify the signature, expiry, actor, app, resource, and field of a direct-upload session.',

  inputs: {
    intent: {
      type: 'string',
      required: true,
      maxLength: 8192
    },
    context: {
      type: 'ref',
      required: true
    }
  },

  exits: {
    success: {
      outputType: 'ref'
    }
  },

  fn: async function ({ intent, context }) {
    const [encoded, suppliedSignature, extra] = intent.split('.')
    if (!encoded || !suppliedSignature || extra !== undefined) {
      throw invalidIntent()
    }
    const expectedSignature = sign(encoded)
    const expectedBuffer = Buffer.from(expectedSignature)
    const suppliedBuffer = Buffer.from(suppliedSignature)
    if (
      expectedBuffer.length !== suppliedBuffer.length ||
      !crypto.timingSafeEqual(expectedBuffer, suppliedBuffer)
    ) {
      throw invalidIntent()
    }

    let payload
    try {
      payload = JSON.parse(Buffer.from(encoded, 'base64url').toString('utf8'))
    } catch {
      throw invalidIntent()
    }

    const expected = {
      actorId: String(context.actorId),
      projectId: String(context.projectId),
      environmentId: String(context.environmentId),
      appId: String(context.appId),
      resource: String(context.resource),
      field: String(context.field)
    }
    if (
      payload.version !== 1 ||
      payload.purpose !== 'bridge-direct-upload' ||
      !['single', 'multipart'].includes(payload.strategy) ||
      !Number.isSafeInteger(payload.issuedAt) ||
      !Number.isSafeInteger(payload.expiresAt) ||
      payload.issuedAt > Date.now() ||
      payload.expiresAt <= Date.now() ||
      Object.entries(expected).some(([key, value]) => payload[key] !== value)
    ) {
      throw invalidIntent()
    }
    return payload
  }
}

function sign(value) {
  const secret = sails.config.session?.secret
  if (typeof secret !== 'string' || secret.length < 16) {
    throw invalidIntent()
  }
  return crypto.createHmac('sha256', secret).update(value).digest('base64url')
}

function invalidIntent() {
  const error = new Error(
    'This upload session is invalid or expired. Choose the file again.'
  )
  error.code = 'BRIDGE_DIRECT_UPLOAD_INTENT_INVALID'
  return error
}
