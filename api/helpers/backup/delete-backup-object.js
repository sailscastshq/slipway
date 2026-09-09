const createStorage = require('../../lib/object-storage')
module.exports = {
  friendlyName: 'Delete backup object',
  description:
    'Delete an object using its original private storage configuration.',
  inputs: {
    s3Key: { type: 'string', description: 'Legacy alias for objectKey' },
    backupId: { type: 'string' },
    storageConfig: { type: 'ref' },
    objectKey: { type: 'string' },
    signal: { type: 'ref' }
  },
  fn: async function ({ s3Key, objectKey, backupId, storageConfig, signal }) {
    const config =
      storageConfig ||
      (await sails.helpers.backup.getStorageConfig.with({ backupId }))
    await createStorage(config).deleteObject({
      objectKey: objectKey || s3Key,
      timeoutMs: 30000,
      signal
    })
  }
}
