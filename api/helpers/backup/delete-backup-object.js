const createBackupStorageAdapter = require('../../lib/backup-storage-adapter')

module.exports = {
  friendlyName: 'Delete S3 object',

  description: 'Delete a single object from S3-compatible storage by key.',

  inputs: {
    s3Key: {
      type: 'string',
      required: true
    }
  },

  fn: async function ({ s3Key }) {
    const storageConfig = await sails.helpers.backup.getStorageConfig()
    const adapter = createBackupStorageAdapter(storageConfig)

    await new Promise((resolve, reject) => {
      adapter.rm(s3Key, (error) => {
        if (error) return reject(error)
        resolve()
      })
    })
  }
}
