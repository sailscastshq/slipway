module.exports = {
  friendlyName: 'Verify Bridge direct upload object',

  description:
    'Read object metadata after a direct upload and require the expected size and content type.',

  inputs: {
    storage: {
      type: 'ref',
      required: true
    },
    objectPath: {
      type: 'string',
      required: true,
      maxLength: 1024
    }
  },

  exits: {
    success: {
      outputType: 'ref'
    }
  },

  fn: async function ({ storage, objectPath }) {
    const client = createClient(storage)
    let metadata
    try {
      metadata = await client
        .headObject({ Bucket: storage.bucket, Key: objectPath })
        .promise()
    } catch (cause) {
      const error = new Error(
        'Bridge could not verify the uploaded object. Please try the upload again.'
      )
      error.code = 'BRIDGE_DIRECT_UPLOAD_NOT_VERIFIED'
      error.cause = cause
      throw error
    }

    if (!Number.isSafeInteger(metadata.ContentLength)) {
      const error = new Error(
        'Bridge could not read the uploaded object size. Please try again.'
      )
      error.code = 'BRIDGE_DIRECT_UPLOAD_NOT_VERIFIED'
      throw error
    }

    return {
      size: metadata.ContentLength,
      type: normalizeType(metadata.ContentType),
      etag: String(metadata.ETag || '').replace(/^"|"$/g, '') || null
    }
  }
}

function createClient(storage) {
  const AWS = require('aws-sdk')
  return new AWS.S3({
    accessKeyId: storage.key,
    secretAccessKey: storage.secret,
    region: storage.region || 'us-east-1',
    ...(storage.endpoint
      ? { endpoint: storage.endpoint, s3ForcePathStyle: true }
      : {}),
    signatureVersion: 'v4',
    httpOptions: {
      connectTimeout: 5000,
      timeout: 15000
    }
  })
}

function normalizeType(value) {
  return String(value || '')
    .split(';')[0]
    .trim()
    .toLowerCase()
}
