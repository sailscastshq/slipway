module.exports = {
  friendlyName: 'Get backup storage config',

  description:
    'Resolve the configured S3-compatible backup storage credentials.',

  exits: {
    success: {
      outputType: 'ref'
    }
  },

  fn: async function () {
    try {
      return await sails.helpers.uploads.getStorageConfig()
    } catch {
      const error = new Error(
        'Backup storage not configured. Go to Settings > Global Environment and set the credentials, bucket, and endpoint for R2, S3, or Spaces.'
      )
      error.code = 'BACKUP_STORAGE_NOT_CONFIGURED'
      throw error
    }
  }
}
