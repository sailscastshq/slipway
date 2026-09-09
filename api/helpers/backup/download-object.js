const fs = require('node:fs')
const createStorage = require('../../lib/object-storage')
module.exports = {
  friendlyName: 'Download backup object',
  description:
    'Download a private backup with bounded streaming and checksum verification.',
  inputs: {
    s3Key: { type: 'string', description: 'Legacy alias for objectKey' },
    destinationPath: { type: 'string', required: true },
    storageConfig: { type: 'ref', required: true },
    maxBytes: { type: 'number', required: true, min: 1 },
    signal: { type: 'ref' },
    timeoutMs: { type: 'number', required: true, min: 1 },
    objectKey: { type: 'string' },
    checksum: { type: 'string' }
  },
  exits: { success: { outputType: 'ref' } },
  fn: async function ({
    s3Key,
    objectKey,
    destinationPath,
    storageConfig,
    maxBytes,
    signal,
    timeoutMs,
    checksum
  }) {
    const handle = await fs.promises.open(destinationPath, 'wx', 0o600)
    const output = handle.createWriteStream()
    try {
      return await createStorage(storageConfig).getObject({
        objectKey: objectKey || s3Key,
        output,
        maxBytes,
        timeoutMs,
        signal,
        checksum
      })
    } catch (error) {
      output.destroy()
      await fs.promises.rm(destinationPath, { force: true })
      throw error
    } finally {
      output.destroy()
    }
  }
}
