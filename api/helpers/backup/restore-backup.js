const fs = require('node:fs')
const fsPromises = require('node:fs/promises')
const os = require('node:os')
const path = require('node:path')

const verifyDatabaseDump = require('../../lib/verify-database-dump')

module.exports = {
  friendlyName: 'Restore backup',

  description:
    'Download a backup and stream it into a database after a verified safety snapshot.',

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

    if (backup.status !== 'completed' || !backup.s3Key) {
      throw new Error(
        'Only a completed backup with a storage key can be restored'
      )
    }

    const service = await Service.findOne({ id: backup.service }).decrypt()
    if (!service) throw new Error('Backup service not found')

    const storageConfig = await sails.helpers.backup.getStorageConfig()
    const limits = sails.config.custom.databaseOperations
    const restoreArgs = getRestoreArgs(service)
    const capacityInputs = {
      directory: os.tmpdir(),
      maxBytes: limits.restoreMaxBytes,
      reserveBytes: limits.minFreeDiskBytes
    }
    if (backup.sizeBytes) capacityInputs.expectedBytes = backup.sizeBytes

    const capacity = await sails.helpers.streams.getDiskCapacity.with(
      capacityInputs
    )
    await createVerifiedSafetySnapshot({ service, signal })

    const extension = getExtension(service.type)
    const tmpDirectory = await fsPromises.mkdtemp(
      path.join(os.tmpdir(), 'slipway-restore-')
    )
    const tmpFile = path.join(tmpDirectory, `database.${extension}`)

    try {
      sails.log.info(
        `Restoring backup ${backupId}: downloading ${backup.s3Key}`
      )
      const transfer = await sails.helpers.backup.downloadObject.with({
        s3Key: backup.s3Key,
        destinationPath: tmpFile,
        storageConfig,
        maxBytes: capacity.allowedBytes,
        signal,
        timeoutMs: limits.restoreTimeoutMs
      })

      if (transfer.bytes === 0) {
        throw new Error('Downloaded backup file is empty')
      }
      if (backup.sizeBytes && transfer.bytes !== backup.sizeBytes) {
        throw new Error(
          `Downloaded backup size does not match its recorded size (${transfer.bytes} of ${backup.sizeBytes} bytes).`
        )
      }

      await verifyDatabaseDump(tmpFile, service.type)
      sails.log.info(`Backup downloaded: ${transfer.bytes} bytes`)

      await sails.helpers.streams.runProcess.with({
        command: sails.config.docker?.binaryPath || 'docker',
        args: restoreArgs,
        input: fs.createReadStream(tmpFile),
        timeoutMs: limits.restoreTimeoutMs,
        maxInputBytes: limits.restoreMaxBytes,
        maxOutputBytes: limits.maxProcessOutputBytes,
        maxStderrBytes: limits.maxProcessStderrBytes,
        signal,
        killGraceMs: limits.killGraceMs
      })

      sails.log.info(
        `Backup ${backupId} restored successfully to ${service.containerName}`
      )

      return { success: true, backupId, serviceName: service.name }
    } finally {
      try {
        await fsPromises.rm(tmpDirectory, { recursive: true, force: true })
      } catch (error) {
        sails.log.warn(
          `Could not remove restore temporary directory: ${error.message}`
        )
      }
    }
  }
}

async function createVerifiedSafetySnapshot({ service, signal }) {
  sails.log.info(`Creating pre-restore snapshot for service ${service.name}`)

  let snapshot
  try {
    snapshot = await Backup.create({
      status: 'pending',
      type: 'manual',
      service: service.id
    }).fetch()

    await sails.helpers.backup.runBackup.with({
      backupId: snapshot.id,
      signal
    })
  } catch (cause) {
    throw createSafetySnapshotError(cause.message, snapshot?.id, cause)
  }

  const verified = await Backup.findOne({ id: snapshot.id })
  if (
    verified?.status !== 'completed' ||
    !verified.s3Key ||
    !verified.sizeBytes
  ) {
    const reason = verified?.errorMessage || 'snapshot was not verified'
    throw createSafetySnapshotError(reason, snapshot.id)
  }

  sails.log.info(`Pre-restore snapshot verified: ${snapshot.id}`)
  return verified
}

function createSafetySnapshotError(reason, snapshotId, cause) {
  const error = new Error(
    `Restore stopped because the pre-restore safety snapshot failed: ${reason}`,
    cause ? { cause } : undefined
  )
  error.code = 'SAFETY_SNAPSHOT_FAILED'
  if (snapshotId) error.snapshotId = snapshotId
  return error
}

function getRestoreArgs(service) {
  if (service.type === 'mongodb') {
    const mongoUri = `mongodb://${service.username}:${service.password}@localhost:27017/${service.database}?authSource=admin`
    return [
      'exec',
      '-i',
      service.containerName,
      'mongorestore',
      '--uri',
      mongoUri,
      '--archive',
      '--gzip',
      '--drop'
    ]
  }

  if (service.type === 'postgresql') {
    return [
      'exec',
      '-i',
      '-e',
      `PGPASSWORD=${service.password}`,
      service.containerName,
      'pg_restore',
      '-U',
      service.username,
      '-d',
      service.database,
      '--no-owner',
      '--clean',
      '--if-exists'
    ]
  }

  if (service.type === 'mysql') {
    return [
      'exec',
      '-i',
      service.containerName,
      'mysql',
      '-u',
      service.username,
      `-p${service.password}`,
      service.database
    ]
  }

  throw new Error(`Restore not supported for service type: ${service.type}`)
}

function getExtension(serviceType) {
  return (
    { postgresql: 'dmp', mysql: 'sql', mongodb: 'gz' }[serviceType] || 'sql'
  )
}
