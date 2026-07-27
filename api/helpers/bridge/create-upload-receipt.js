const crypto = require('node:crypto')

module.exports = {
  friendlyName: 'Create Bridge upload receipt',

  description:
    'Sign a short-lived receipt that binds an uploaded URL to an authorized Bridge field.',

  inputs: {
    url: {
      type: 'string',
      required: true,
      maxLength: 2048
    },
    context: {
      type: 'ref',
      required: true
    },
    expiresInMs: {
      type: 'number',
      defaultsTo: 30 * 60 * 1000,
      min: 60 * 1000,
      max: 24 * 60 * 60 * 1000
    }
  },

  exits: {
    success: {
      outputType: 'string'
    }
  },

  fn: async function ({ url, context, expiresInMs }) {
    assertSafeUrl(url)
    assertContext(context)
    const payload = {
      version: 1,
      url,
      actorId: String(context.actorId),
      projectId: String(context.projectId),
      environmentId: String(context.environmentId),
      resource: String(context.resource),
      field: String(context.field),
      issuedAt: Date.now(),
      expiresAt: Date.now() + expiresInMs
    }

    const encoded = Buffer.from(JSON.stringify(payload)).toString('base64url')
    const signature = sign(encoded)
    return `${encoded}.${signature}`
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

function assertSafeUrl(value) {
  let url
  try {
    url = new URL(value)
  } catch {
    throw new Error('Bridge upload URL is invalid.')
  }
  if (!['http:', 'https:'].includes(url.protocol)) {
    throw new Error('Bridge upload URL must use HTTP or HTTPS.')
  }
}

function assertContext(context) {
  for (const key of [
    'actorId',
    'projectId',
    'environmentId',
    'resource',
    'field'
  ]) {
    if (
      context[key] === undefined ||
      context[key] === null ||
      !/^[A-Za-z0-9._-]+$/.test(String(context[key]))
    ) {
      const error = new Error(`Bridge upload context "${key}" is invalid.`)
      error.code = 'BRIDGE_UPLOAD_CONTEXT_INVALID'
      throw error
    }
  }
}
