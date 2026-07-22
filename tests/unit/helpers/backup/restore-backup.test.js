const { test } = require('sounding')

test(
  'restore never reaches the database when its safety snapshot fails',
  {
    world: {
      name: 'configured-slipway',
      context: {
        deploymentTarget: { slug: 'restore-safety', name: 'Restore Safety' }
      }
    }
  },
  async ({ sails, world, expect }) => {
    const service = await world.create('service').with({
      environment: world.current.environments.production.id,
      name: 'main-db',
      status: 'running',
      containerName: 'slipway-restore-safety-main-db',
      database: 'restore_safety',
      username: 'postgres',
      password: 'secret'
    })
    const sourceBackup = await world.create('backup').with({
      service: service.id,
      status: 'completed',
      s3Key: 'backups/restore-safety/source.dmp',
      sizeBytes: 1024
    })

    const originalRunBackup = sails.helpers.backup.runBackup
    const originalDownload = sails.helpers.backup.downloadObject
    const originalStorageConfig = sails.helpers.backup.getStorageConfig
    const originalDiskCapacity = sails.helpers.streams.getDiskCapacity
    let downloadStarted = false

    sails.helpers.backup.getStorageConfig = async () => ({
      key: 'test',
      secret: 'test',
      bucket: 'test'
    })
    const allowRestoreFile = async () => ({ allowedBytes: 2048 })
    allowRestoreFile.with = allowRestoreFile
    sails.helpers.streams.getDiskCapacity = allowRestoreFile

    const failSafetySnapshot = async ({ backupId }) => {
      return sails.models.backup.updateOne({ id: backupId }).set({
        status: 'failed',
        errorMessage: 'Object storage is unavailable',
        completedAt: Date.now()
      })
    }
    failSafetySnapshot.with = failSafetySnapshot
    sails.helpers.backup.runBackup = failSafetySnapshot

    const rejectDownload = async () => {
      downloadStarted = true
      throw new Error('The destructive restore path should not run')
    }
    rejectDownload.with = rejectDownload
    sails.helpers.backup.downloadObject = rejectDownload

    try {
      const error = await captureError(
        sails.helpers.backup.restoreBackup(sourceBackup.id)
      )

      expect(error.code).toBe('SAFETY_SNAPSHOT_FAILED')
      expect(error.message).toContain('Object storage is unavailable')
      expect(downloadStarted).toBe(false)
    } finally {
      sails.helpers.backup.runBackup = originalRunBackup
      sails.helpers.backup.downloadObject = originalDownload
      sails.helpers.backup.getStorageConfig = originalStorageConfig
      sails.helpers.streams.getDiskCapacity = originalDiskCapacity
    }
  }
)

async function captureError(promise) {
  try {
    await promise
  } catch (error) {
    return error
  }

  throw new Error('Expected operation to fail.')
}
