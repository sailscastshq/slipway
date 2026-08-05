const crypto = require('node:crypto')

module.exports = {
  friendlyName: 'Create Bridge direct upload intent',

  description:
    'Sign a resumable direct-upload session without exposing storage credentials.',

  inputs: {
    context: {
      type: 'ref',
      required: true
    },
    upload: {
      type: 'ref',
      required: true
    },
    expiresInMs: {
      type: 'number',
      defaultsTo: 24 * 60 * 60 * 1000,
      min: 60 * 1000,
      max: 7 * 24 * 60 * 60 * 1000
    }
  },

  exits: {
    success: {
      outputType: 'string'
    }
  },

  fn: async function ({ context, upload, expiresInMs }) {
    assertContext(context)
    assertUpload(upload)
    const now = Date.now()
    const payload = {
      version: 1,
      purpose: 'bridge-direct-upload',
      actorId: String(context.actorId),
      projectId: String(context.projectId),
      environmentId: String(context.environmentId),
      appId: String(context.appId),
      resource: String(context.resource),
      field: String(context.field),
      strategy: upload.strategy,
      url: upload.url,
      objectPath: upload.objectPath,
      fileSize: upload.fileSize,
      fileType: normalizeType(upload.fileType),
      recordId:
        upload.recordId === undefined || upload.recordId === null
          ? null
          : String(upload.recordId),
      uploadId: upload.uploadId || null,
      partSize: upload.partSize || null,
      partCount: upload.partCount || null,
      issuedAt: now,
      expiresAt: now + expiresInMs
    }
    const encoded = Buffer.from(JSON.stringify(payload)).toString('base64url')
    return `${encoded}.${sign(encoded)}`
  }
}

function assertContext(context) {
  for (const key of [
    'actorId',
    'projectId',
    'environmentId',
    'appId',
    'resource',
    'field'
  ]) {
    if (
      context[key] === undefined ||
      context[key] === null ||
      !/^[A-Za-z0-9._-]+$/.test(String(context[key]))
    ) {
      throw new Error(`Bridge upload context "${key}" is invalid.`)
    }
  }
}

function assertUpload(upload) {
  if (!['single', 'multipart'].includes(upload.strategy)) {
    throw new Error('Bridge upload strategy is invalid.')
  }
  const url = new URL(upload.url)
  if (!['http:', 'https:'].includes(url.protocol)) {
    throw new Error('Bridge upload URL must use HTTP or HTTPS.')
  }
  if (
    typeof upload.objectPath !== 'string' ||
    !upload.objectPath ||
    upload.objectPath.length > 1024 ||
    upload.objectPath.split('/').some((segment) => !segment || segment === '..')
  ) {
    throw new Error('Bridge upload object path is invalid.')
  }
  if (!Number.isSafeInteger(upload.fileSize) || upload.fileSize < 1) {
    throw new Error('Bridge upload file size is invalid.')
  }
  if (!normalizeType(upload.fileType)) {
    throw new Error('Bridge upload file type is invalid.')
  }
  if (upload.strategy === 'multipart') {
    if (
      !upload.uploadId ||
      !Number.isSafeInteger(upload.partSize) ||
      upload.partSize < 5 * 1024 * 1024 ||
      !Number.isInteger(upload.partCount) ||
      upload.partCount < 1 ||
      upload.partCount > 10_000
    ) {
      throw new Error('Bridge multipart upload details are invalid.')
    }
  }
}

function sign(value) {
  const secret = sails.config.session?.secret
  if (typeof secret !== 'string' || secret.length < 16) {
    throw new Error('Bridge uploads require a strong Slipway session secret.')
  }
  return crypto.createHmac('sha256', secret).update(value).digest('base64url')
}

function normalizeType(value) {
  return String(value || '')
    .split(';')[0]
    .trim()
    .toLowerCase()
}
