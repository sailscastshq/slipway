module.exports = {
  friendlyName: 'Create Bridge direct upload URL',

  description:
    'Create a short-lived object-store PUT URL without exposing storage credentials.',

  inputs: {
    storage: {
      type: 'ref',
      required: true
    },
    objectPath: {
      type: 'string',
      required: true,
      maxLength: 1024
    },
    contentType: {
      type: 'string',
      required: true,
      maxLength: 255
    },
    expiresInSeconds: {
      type: 'number',
      defaultsTo: 15 * 60,
      min: 60,
      max: 60 * 60
    }
  },

  exits: {
    success: {
      outputType: 'string'
    }
  },

  fn: async function ({ storage, objectPath, contentType, expiresInSeconds }) {
    const client = createClient(storage)
    return new Promise((resolve, reject) => {
      client.getSignedUrl(
        'putObject',
        {
          Bucket: storage.bucket,
          Key: objectPath,
          ContentType: contentType,
          Expires: expiresInSeconds
        },
        (error, url) => {
          if (error) reject(error)
          else resolve(url)
        }
      )
    })
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
