const { execFile } = require('child_process')
const fs = require('fs')
const path = require('path')
const os = require('os')

module.exports = {
  friendlyName: 'Run backup',

  description: 'Dump a database service and upload to S3-compatible storage.',

  inputs: {
    backupId: {
      type: 'string',
      required: true
    }
  },

  exits: {
    success: {
      outputType: 'ref'
    }
  },

  fn: async function ({ backupId }) {
    const backup = await Backup.findOne({ id: backupId })
    if (!backup || !backup.service) {
      throw new Error('Backup or service not found')
    }

    const service = await Service.findOne({ id: backup.service }).decrypt()
    const startedAt = Date.now()

    await Backup.updateOne({ id: backupId }).set({
      status: 'running',
      startedAt
    })
    sails.sse.publish(`backup:${backupId}`, { status: 'running' })

    // Read S3 config from global env vars (stored in Settings), fall back to sails.config.uploads
    let globalEnvVars = {}
    try {
      const globalJson = await sails.helpers.setting.get('globalEnvVars', '{}')
      globalEnvVars = JSON.parse(globalJson)
    } catch { /* ignore */ }

    const uploadsConfig = {
      key: globalEnvVars.R2_ACCESS_KEY || globalEnvVars.S3_ACCESS_KEY || globalEnvVars.SPACES_ACCESS_KEY || (sails.config.uploads || {}).key,
      secret: globalEnvVars.R2_SECRET_KEY || globalEnvVars.S3_SECRET_KEY || globalEnvVars.SPACES_SECRET_KEY || (sails.config.uploads || {}).secret,
      bucket: globalEnvVars.R2_BUCKET || globalEnvVars.S3_BUCKET || globalEnvVars.SPACES_BUCKET || (sails.config.uploads || {}).bucket,
      endpoint: globalEnvVars.R2_ENDPOINT || globalEnvVars.S3_ENDPOINT || globalEnvVars.SPACES_ENDPOINT || (sails.config.uploads || {}).endpoint,
      region: globalEnvVars.S3_REGION || globalEnvVars.SPACES_REGION || (sails.config.uploads || {}).region
    }

    if (!uploadsConfig.key || !uploadsConfig.secret || !uploadsConfig.bucket) {
      await Backup.updateOne({ id: backupId }).set({
        status: 'failed',
        errorMessage: 'Backup storage not configured. Go to Settings > Global Environment and set R2_ACCESS_KEY, R2_SECRET_KEY, R2_BUCKET, and R2_ENDPOINT.',
        completedAt: Date.now(),
        durationMs: Date.now() - startedAt
      })
      sails.sse.publish(`backup:${backupId}`, { status: 'failed' })
      return backup
    }

    // Build the dump command args per service type
    const dumpArgs = getDumpArgs(service)
    if (!dumpArgs) {
      await Backup.updateOne({ id: backupId }).set({
        status: 'failed',
        errorMessage: `Backup not supported for service type: ${service.type}`,
        completedAt: Date.now(),
        durationMs: Date.now() - startedAt
      })
      sails.sse.publish(`backup:${backupId}`, { status: 'failed' })
      return backup
    }

    // Generate S3 key path
    const env = await Environment.findOne({ id: service.environment }).populate('project')
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-')
    const ext = { postgresql: 'dmp', mysql: 'sql', mongodb: 'gz' }[service.type] || 'sql'
    const s3Key = `backups/${env.project.slug}/${env.slug}/${service.name}/${timestamp}.${ext}`

    // Temp file for the dump
    const tmpFile = path.join(os.tmpdir(), `slipway-backup-${backupId}.${ext}`)

    try {
      // Run docker exec to dump database, stream stdout to temp file
      const dockerBinary = sails.config.docker?.binaryPath || 'docker'
      const dockerArgs = ['exec', service.containerName, ...dumpArgs]

      await new Promise((resolve, reject) => {
        const child = execFile(dockerBinary, dockerArgs, {
          maxBuffer: 1024 * 1024 * 512,
          encoding: 'buffer'
        }, (err, stdout, stderr) => {
          if (err) return reject(new Error(`Dump failed: ${stderr ? stderr.toString() : err.message}`))
          try {
            fs.writeFileSync(tmpFile, stdout)
            resolve()
          } catch (writeErr) {
            reject(writeErr)
          }
        })
      })

      // Get file size
      const stats = fs.statSync(tmpFile)
      const sizeBytes = stats.size

      if (sizeBytes === 0) {
        throw new Error('Dump produced an empty file')
      }

      // Verify dump file integrity by checking format-specific headers
      const header = Buffer.alloc(5)
      const fd = fs.openSync(tmpFile, 'r')
      fs.readSync(fd, header, 0, 5, 0)
      fs.closeSync(fd)
      if (service.type === 'postgresql' && header.toString('ascii', 0, 5) !== 'PGDMP') {
        throw new Error('PostgreSQL dump has invalid header — expected PGDMP format')
      }
      if (service.type === 'mongodb' && (header[0] !== 0x1f || header[1] !== 0x8b)) {
        throw new Error('MongoDB dump has invalid header — expected gzip format')
      }

      // Upload to S3 via sails-hook-uploads (uses skipper-s3 under the hood)
      const readStream = fs.createReadStream(tmpFile)
      readStream.filename = path.basename(s3Key)

      await sails.uploadOne(readStream, {
        adapter: require('skipper-s3'),
        key: uploadsConfig.key,
        secret: uploadsConfig.secret,
        bucket: uploadsConfig.bucket,
        endpoint: uploadsConfig.endpoint,
        region: uploadsConfig.region,
        s3ForcePathStyle: true,
        saveAs: s3Key
      })

      // Update backup record
      const completedAt = Date.now()
      await Backup.updateOne({ id: backupId }).set({
        status: 'completed',
        s3Key,
        sizeBytes,
        completedAt,
        durationMs: completedAt - startedAt
      })

      sails.log.info(`Backup completed: ${s3Key} (${formatBytes(sizeBytes)} in ${completedAt - startedAt}ms)`)
      sails.sse.publish(`backup:${backupId}`, { status: 'completed' })

      // Send backup success notification
      await sails.helpers.notification.sendBackupNotification.with({
        backup: await Backup.findOne({ id: backupId }),
        service
      }).tolerate('error')
    } catch (err) {
      const completedAt = Date.now()
      await Backup.updateOne({ id: backupId }).set({
        status: 'failed',
        errorMessage: err.message,
        completedAt,
        durationMs: completedAt - startedAt
      })
      sails.log.error(`Backup failed for service ${service.name}: ${err.message}`)
      sails.sse.publish(`backup:${backupId}`, { status: 'failed' })

      // Send backup failure notification
      await sails.helpers.notification.sendBackupNotification.with({
        backup: await Backup.findOne({ id: backupId }),
        service
      }).tolerate('error')
    } finally {
      // Clean up temp file
      try { fs.unlinkSync(tmpFile) } catch { /* ignore */ }
    }

    return await Backup.findOne({ id: backupId })
  }
}

function getDumpArgs(service) {
  switch (service.type) {
    case 'postgresql':
      return ['pg_dump', '-U', service.username, '--format=custom', service.database]
    case 'mysql':
      return ['mysqldump', '-u', service.username, `-p${service.password}`, '--single-transaction', '--routines', '--triggers', '--quick', service.database]
    case 'mongodb':
      return ['mongodump', '--archive', '--gzip', '--db', service.database, '--username', service.username, '--password', service.password]
    default:
      return null
  }
}

function formatBytes(bytes) {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}
