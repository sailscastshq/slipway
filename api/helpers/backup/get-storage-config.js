module.exports = {
  friendlyName: 'Get backup storage config',
  description:
    'Resolve private backup storage, preserving the configuration bound to older objects.',
  inputs: { backupId: { type: 'string' } },
  exits: { success: { outputType: 'ref' } },
  fn: async function ({ backupId }) {
    if (backupId) {
      const backup = await Backup.findOne({ id: backupId }).decrypt()
      if (
        backup?.storageCredentials &&
        Object.keys(backup.storageCredentials).length
      )
        return backup.storageCredentials
      // Legacy objects always resolve through the original S3 upload settings.
      if (backup?.s3Key) return sails.helpers.uploads.getStorageConfig()
    }
    const configured = await require('../../lib/backup-storage-config').saved()
    if (configured.provider !== 'shared') return configured
    try {
      return await sails.helpers.uploads.getStorageConfig()
    } catch {
      const error = new Error(
        'Private backup storage is not configured. Complete Settings → File storage → Backup storage.'
      )
      error.code = 'BACKUP_STORAGE_NOT_CONFIGURED'
      throw error
    }
  }
}
