const AWS = require('aws-sdk')

module.exports = {
  friendlyName: 'Delete Bearing feedback images',

  description:
    'Remove uploaded Bearing images when the feedback record cannot be saved.',

  inputs: {
    storage: {
      type: 'ref',
      required: true
    },
    images: {
      type: 'json',
      defaultsTo: []
    }
  },

  fn: async function ({ storage, images }) {
    const objects = images
      .map((image) => image?.objectPath)
      .filter(
        (objectPath) =>
          typeof objectPath === 'string' &&
          objectPath.startsWith('bearing/') &&
          !objectPath.split('/').includes('..')
      )
      .map((Key) => ({ Key }))
    if (!objects.length) return

    const client = new AWS.S3({
      accessKeyId: storage.key,
      secretAccessKey: storage.secret,
      region: storage.region || 'auto',
      ...(storage.endpoint
        ? { endpoint: storage.endpoint, s3ForcePathStyle: true }
        : {}),
      signatureVersion: 'v4',
      httpOptions: {
        connectTimeout: 5000,
        timeout: 30_000
      },
      maxRetries: 2
    })

    await client
      .deleteObjects({
        Bucket: storage.bucket,
        Delete: { Objects: objects, Quiet: true }
      })
      .promise()
  }
}
