module.exports = {
  friendlyName: 'Bind legacy backup storage',
  description:
    'Preserve the original connection before changing shared file storage settings.',
  fn: async function () {
    const backups = await Backup.find({
      status: 'completed',
      s3Key: { '!=': null }
    })
    const unbound = backups.filter((backup) => !backup.storageCredentials)
    if (!unbound.length) return
    const storage = await sails.helpers.uploads.getStorageConfig()
    for (const backup of unbound) {
      await Backup.updateOne({ id: backup.id }).set({
        objectKey: backup.s3Key,
        storageCredentials: storage,
        storage: { provider: storage.provider, container: storage.bucket }
      })
    }
  }
}
