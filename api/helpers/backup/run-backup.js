const fs = require('node:fs')
const fsPromises = require('node:fs/promises')
const os = require('node:os')
const path = require('node:path')
const { randomUUID } = require('node:crypto')

const verifyDatabaseDump = require('../../lib/verify-database-dump')

module.exports = {
  friendlyName: 'Run backup',

  description: 'Dump a database service and upload to S3-compatible storage.',

  inputs: {
    backupId: {
      type: 'string',
      required: true
    },
    signal: {
      type: 'ref',
      description: 'Optional AbortSignal.'
    }
  },

  exits: {
    success: {
      outputType: 'ref'
    }
  },

  fn: async function ({ backupId, signal }) {
    const backup = await Backup.findOne({ id: backupId })
    if (!backup || !backup.service) {
      throw new Error('Backup or service not found')
    }

    const startedAt = Date.now()
    let service
    let tmpDirectory
    let objectKey
    let storageConfig
    let storageMetadata
    let uploadAttempted = false

    await Backup.updateOne({ id: backupId }).set({
      status: 'running',
      errorMessage: null,
      startedAt
    })
    sails.sse.publish(`backup:${backupId}`, { status: 'running' })

    try {
      service = await Service.findOne({ id: backup.service }).decrypt()
      if (!service) throw new Error('Backup service not found')

      storageConfig = await sails.helpers.backup.getStorageConfig()
      const dumpArgs = getDumpArgs(service)
      if (!dumpArgs) {
        throw new Error(
          `Backup not supported for service type: ${service.type}`
        )
      }

      const environment = await Environment.findOne({
        id: service.environment
      }).populate('project')
      if (!environment?.project) {
        throw new Error('Backup environment or project not found')
      }

      const extension = getExtension(service.type)
      const timestamp = new Date().toISOString().replace(/[:.]/g, '-')
      objectKey = `backups/${environment.project.slug}/${environment.slug}/${
        service.name
      }/${timestamp}-${randomUUID()}.${extension}`

      storageMetadata = {
        provider: storageConfig.provider || 's3',
        container: storageConfig.bucket
      }
      await Backup.updateOne({ id: backupId }).set({
        storageCredentials: storageConfig,
        storage: storageMetadata
      })

      const limits = sails.config.custom.databaseOperations
      const capacity = await sails.helpers.streams.getDiskCapacity.with({
        directory: os.tmpdir(),
        maxBytes: limits.backupMaxBytes,
        reserveBytes: limits.minFreeDiskBytes
      })

      tmpDirectory = await fsPromises.mkdtemp(
        path.join(os.tmpdir(), 'slipway-backup-')
      )
      const tmpFile = path.join(tmpDirectory, `database.${extension}`)
      const dockerBinary = sails.config.docker?.binaryPath || 'docker'

      if (service.managementMode === 'external') {
        await sails.helpers.service.runExternalClient.with({
          serviceId: String(service.id),
          operation: 'dump',
          output: fs.createWriteStream(tmpFile, { flags: 'wx', mode: 0o600 }),
          timeoutMs: limits.backupTimeoutMs,
          maxBytes: capacity.allowedBytes,
          signal
        })
      } else {
        await sails.helpers.streams.runProcess.with({
          command: dockerBinary,
          args: ['exec', service.containerName, ...dumpArgs],
          output: fs.createWriteStream(tmpFile, { flags: 'wx', mode: 0o600 }),
          timeoutMs: limits.backupTimeoutMs,
          maxOutputBytes: capacity.allowedBytes,
          maxStderrBytes: limits.maxProcessStderrBytes,
          signal,
          killGraceMs: limits.killGraceMs
        })
      }

      const stats = await fsPromises.stat(tmpFile)
      if (stats.size === 0) throw new Error('Dump produced an empty file')
      await verifyDatabaseDump(tmpFile, service.type)

      uploadAttempted = true

      const uploaded = await sails.helpers.backup.uploadObject.with({
        sourcePath: tmpFile,
        objectKey,
        sizeBytes: stats.size,
        storageConfig,
        maxBytes: capacity.allowedBytes,
        timeoutMs: limits.backupTimeoutMs,
        signal
      })

      const completedAt = Date.now()
      await Backup.updateOne({ id: backupId }).set({
        status: 'completed',
        objectKey,
        s3Key: storageConfig.provider === 'azure' ? null : objectKey,
        storage: { ...storageMetadata, ...uploaded, uploadedAt: completedAt },
        sizeBytes: stats.size,
        completedAt,
        durationMs: completedAt - startedAt
      })

      sails.log.info(
        `Backup completed: ${objectKey} (${formatBytes(stats.size)} in ${
          completedAt - startedAt
        }ms)`
      )
      sails.sse.publish(`backup:${backupId}`, { status: 'completed' })
    } catch (error) {
      let cleanupPending = false
      if (uploadAttempted && objectKey) {
        try {
          await sails.helpers.backup.deleteBackupObject.with({
            objectKey,
            storageConfig
          })
        } catch (cleanupError) {
          cleanupPending = true
          sails.log.warn(
            `Could not clean up partial backup ${objectKey}: ${cleanupError.message}`
          )
        }
      }

      const completedAt = Date.now()
      await Backup.updateOne({ id: backupId }).set({
        status: 'failed',
        s3Key: null,
        objectKey: cleanupPending ? objectKey : null,
        storage: { ...storageMetadata, cleanupPending },
        sizeBytes: null,
        errorMessage: error.message,
        completedAt,
        durationMs: completedAt - startedAt
      })
      sails.log.error(
        `Backup failed for service ${service?.name || backup.service}: ${
          error.message
        }`
      )
      sails.sse.publish(`backup:${backupId}`, { status: 'failed' })
    } finally {
      if (tmpDirectory) {
        try {
          await fsPromises.rm(tmpDirectory, { recursive: true, force: true })
        } catch (error) {
          sails.log.warn(
            `Could not remove backup temporary directory: ${error.message}`
          )
        }
      }

      if (service) {
        await sails.helpers.notification.sendBackupNotification
          .with({
            backup: await Backup.findOne({ id: backupId }),
            service
          })
          .tolerate('error')
      }
    }

    return Backup.findOne({ id: backupId })
  }
}

function getDumpArgs(service) {
  switch (service.type) {
    case 'postgresql':
      return [
        'pg_dump',
        '-U',
        service.username,
        '--format=custom',
        service.database
      ]
    case 'mysql':
      return [
        'mysqldump',
        '-u',
        service.username,
        `-p${service.password}`,
        '--single-transaction',
        '--routines',
        '--triggers',
        '--quick',
        service.database
      ]
    case 'mongodb':
      return [
        'mongodump',
        '--archive',
        '--gzip',
        '--db',
        service.database,
        '--username',
        service.username,
        '--password',
        service.password
      ]
    default:
      return null
  }
}

function getExtension(serviceType) {
  return (
    { postgresql: 'dmp', mysql: 'sql', mongodb: 'gz' }[serviceType] || 'sql'
  )
}

function formatBytes(bytes) {
  const units = ['B', 'KB', 'MB', 'GB', 'TB']
  let value = bytes
  let unit = 0

  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024
    unit += 1
  }

  return `${value.toFixed(unit === 0 ? 0 : 1)} ${units[unit]}`
}
