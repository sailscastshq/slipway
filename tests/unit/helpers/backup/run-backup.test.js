const fsPromises = require('node:fs/promises')
const os = require('node:os')

const { test } = require('sounding')

test(
  'backup records fail consistently and temporary files are removed on disk errors',
  {
    world: {
      name: 'configured-slipway',
      context: {
        deploymentTarget: { slug: 'backup-stream', name: 'Backup Stream' }
      }
    }
  },
  async ({ sails, world, expect }) => {
    const service = await world.create('service').with({
      environment: world.current.environments.production.id,
      name: 'main-db',
      status: 'running',
      containerName: 'slipway-backup-stream-main-db',
      database: 'backup_stream',
      username: 'postgres',
      password: 'secret'
    })
    const backup = await world.create('backup').with({ service: service.id })
    const tempBefore = await backupTempDirectories()

    const originalStorageConfig = sails.helpers.backup.getStorageConfig
    const originalRunProcess = sails.helpers.streams.runProcess
    const originalNotification =
      sails.helpers.notification.sendBackupNotification

    sails.helpers.backup.getStorageConfig = async () => ({
      key: 'test',
      secret: 'test',
      bucket: 'test'
    })

    const failDumpWrite = async ({ output }) => {
      output.destroy()
      const error = new Error('No space left on device')
      error.code = 'ENOSPC'
      throw error
    }
    failDumpWrite.with = failDumpWrite
    sails.helpers.streams.runProcess = failDumpWrite

    const ignoreNotification = async () => {}
    ignoreNotification.with = () => ({
      tolerate: async () => {}
    })
    sails.helpers.notification.sendBackupNotification = ignoreNotification

    try {
      const result = await sails.helpers.backup.runBackup(backup.id)
      const tempAfter = await backupTempDirectories()

      expect(result.status).toBe('failed')
      expect(result.errorMessage).toContain('No space left on device')
      expect(result.completedAt >= result.startedAt).toBe(true)
      expect(result.s3Key).toBe(null)
      expect(tempAfter).toEqual(tempBefore)
    } finally {
      sails.helpers.backup.getStorageConfig = originalStorageConfig
      sails.helpers.streams.runProcess = originalRunProcess
      sails.helpers.notification.sendBackupNotification = originalNotification
    }
  }
)

async function backupTempDirectories() {
  const names = await fsPromises.readdir(os.tmpdir())
  return names.filter((name) => name.startsWith('slipway-backup-')).sort()
}
