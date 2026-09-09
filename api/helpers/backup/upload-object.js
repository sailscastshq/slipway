const fs = require('node:fs')
const createStorage = require('../../lib/object-storage')
module.exports = {
  friendlyName: 'Upload backup object',
  description:
    'Stream a verified backup into private object storage with size and time bounds.',
  inputs: {
    sourcePath: { type: 'string', required: true },
    s3Key: { type: 'string', description: 'Legacy alias for objectKey' },
    sizeBytes: { type: 'number', required: true, min: 1 },
    storageConfig: { type: 'ref', required: true },
    maxBytes: { type: 'number', required: true, min: 1 },
    timeoutMs: { type: 'number', required: true, min: 1 },
    signal: { type: 'ref' },
    objectKey: { type: 'string' }
  },
  exits: { success: { outputType: 'ref' } },
  fn: async function ({
    sourcePath,
    s3Key,
    objectKey,
    sizeBytes,
    storageConfig,
    maxBytes,
    timeoutMs,
    signal
  }) {
    if (sizeBytes > maxBytes) {
      const error = new Error(
        'Backup upload exceeds the configured size limit.'
      )
      error.code = 'STREAM_SIZE_LIMIT'
      throw error
    }
    const input = fs.createReadStream(sourcePath)
    try {
      const storage = createStorage(storageConfig)
      const uploaded = await storage.putObject({
        objectKey: objectKey || s3Key,
        input,
        maxBytes,
        timeoutMs,
        signal
      })
      if (uploaded.bytes !== sizeBytes) {
        await storage.deleteObject({ objectKey: objectKey || s3Key })
        const error = new Error(
          'The backup changed while it was being uploaded. Create a new backup.'
        )
        error.code = 'STORAGE_INTEGRITY'
        throw error
      }
      return uploaded
    } finally {
      input.destroy()
    }
  }
}
