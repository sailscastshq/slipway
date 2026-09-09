const settings = require('../../lib/backup-storage-config')
const storage = require('../../lib/object-storage')
module.exports = {
  friendlyName: 'Update private backup storage',
  inputs: {
    configuration: { type: 'ref', required: true },
    testOnly: { type: 'boolean', defaultsTo: false }
  },
  exits: {
    success: { statusCode: 200 },
    badRequest: { responseType: 'badRequest' }
  },
  fn: async function ({ configuration, testOnly }) {
    const user = await User.forRequest(this.req)
    try {
      const configured = settings.resolve(configuration, await settings.saved())
      const candidate =
        configured.provider === 'shared'
          ? await sails.helpers.uploads.getStorageConfig()
          : configured
      await storage(candidate).testConnection({ timeoutMs: 15000 })
      if (!testOnly) {
        await sails.helpers.backup.bindLegacyStorage()
        await sails.getDatastore().transaction(async (connection) => {
          const existing = await Setting.findOne({
            key: 'backupStorageConfig'
          }).usingConnection(connection)
          const values = {
            encryptedValue: JSON.stringify(configured),
            value: null
          }
          if (existing)
            await Setting.updateOne({ id: existing.id })
              .set(values)
              .usingConnection(connection)
          else
            await Setting.create({
              key: 'backupStorageConfig',
              ...values
            }).usingConnection(connection)
          const location = require('../../lib/backup-storage-location')
          const backups = await Backup.find()
            .decrypt()
            .usingConnection(connection)
          for (const backup of backups) {
            if (
              backup.storageCredentials &&
              location(backup.storageCredentials) === location(candidate)
            ) {
              await Backup.updateOne({ id: backup.id })
                .set({ storageCredentials: candidate })
                .usingConnection(connection)
            }
          }
          await AuditLog.create({
            action: 'backup.storage.updated',
            resourceType: 'setting',
            resourceId: 'backupStorageConfig',
            user: user.id,
            team: user.team,
            details: {
              provider: configured.provider,
              capabilities: ['private-put', 'private-get', 'delete']
            }
          }).usingConnection(connection)
        })
        await sails.cache.delete('setting:backupStorageConfig').catch(() => {})
      }
      return {
        success: true,
        verified: true,
        message: testOnly
          ? 'Private upload, download, and deletion verified.'
          : 'Private backup storage saved and verified.',
        config: settings.publicConfig(configured)
      }
    } catch (error) {
      throw {
        badRequest: {
          error: error.field
            ? error.message
            : require('../../lib/object-storage/errors')(error).message,
          code: error.code || 'STORAGE_CONFIGURATION',
          field: error.field || null
        }
      }
    }
  }
}
