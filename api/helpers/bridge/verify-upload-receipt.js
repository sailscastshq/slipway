const crypto = require('node:crypto')

module.exports = {
  friendlyName: 'Verify Bridge upload receipt',

  description:
    'Verify that an uploaded URL was issued for the current Bridge actor and field.',

  inputs: {
    receipt: {
      type: 'string',
      required: true,
      maxLength: 4096
    },
    url: {
      type: 'string',
      required: true,
      maxLength: 2048
    },
    context: {
      type: 'ref',
      required: true
    }
  },

  exits: {
    success: {
      outputType: 'string'
    }
  },

  fn: async function ({ receipt, url, context }) {
    const [encoded, suppliedSignature, extra] = receipt.split('.')
    if (!encoded || !suppliedSignature || extra !== undefined) {
      throw invalidReceipt()
    }

    const expectedSignature = sign(encoded)
    const expectedBuffer = Buffer.from(expectedSignature)
    const suppliedBuffer = Buffer.from(suppliedSignature)
    if (
      expectedBuffer.length !== suppliedBuffer.length ||
      !crypto.timingSafeEqual(expectedBuffer, suppliedBuffer)
    ) {
      throw invalidReceipt()
    }

    let payload
    try {
      payload = JSON.parse(Buffer.from(encoded, 'base64url').toString('utf8'))
    } catch {
      throw invalidReceipt()
    }

    const expected = {
      actorId: String(context.actorId),
      projectId: String(context.projectId),
      environmentId: String(context.environmentId),
      resource: String(context.resource),
      field: String(context.field)
    }
    if (
      payload.version !== 1 ||
      payload.url !== url ||
      !Number.isSafeInteger(payload.issuedAt) ||
      !Number.isSafeInteger(payload.expiresAt) ||
      payload.issuedAt > Date.now() ||
      payload.expiresAt <= Date.now() ||
      Object.entries(expected).some(([key, value]) => payload[key] !== value)
    ) {
      throw invalidReceipt()
    }

    let parsed
    try {
      parsed = new URL(payload.url)
    } catch {
      throw invalidReceipt()
    }
    if (!['http:', 'https:'].includes(parsed.protocol)) {
      throw invalidReceipt()
    }

    return payload.url
  }
}

function sign(value) {
  const secret = sails.config.session?.secret
  if (typeof secret !== 'string' || secret.length < 16) {
    const error = new Error(
      'Bridge uploads require a strong Slipway session secret.'
    )
    error.code = 'BRIDGE_UPLOAD_SECRET_UNAVAILABLE'
    throw error
  }
  return crypto.createHmac('sha256', secret).update(value).digest('base64url')
}

function invalidReceipt() {
  const error = new Error(
    'Upload this file through Bridge before saving the record.'
  )
  error.code = 'BRIDGE_UPLOAD_RECEIPT_INVALID'
  return error
}
