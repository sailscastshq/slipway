const createClient = require('../../lib/s3-client')

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

    const client = createClient(storage)
    try {
      await client.deleteObjects({
        Bucket: storage.bucket,
        Delete: { Objects: objects, Quiet: true }
      })
    } finally {
      client.destroy()
    }
  }
}
