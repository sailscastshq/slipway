const fs = require('fs')
const path = require('path')
const os = require('os')
const { spawn } = require('child_process')

module.exports = {
  friendlyName: 'Restore backup',

  description: 'Download a backup from S3 and restore it into the database service.',

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

    if (!backup.s3Key) {
      throw new Error('Backup has no S3 key — cannot restore')
    }

    const service = await Service.findOne({ id: backup.service }).decrypt()

    // Read S3 config (same pattern as run-backup.js)
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
      throw new Error('Backup storage not configured')
    }

    const ext = service.type === 'mongodb' ? 'gz' : 'sql'
    const tmpFile = path.join(os.tmpdir(), `slipway-restore-${backupId}.${ext}`)

    try {
      // 1. Download from S3 using skipper-s3's read() method
      sails.log.info(`Restoring backup ${backupId}: downloading ${backup.s3Key}`)

      const skipperS3 = require('skipper-s3')
      const adapterOpts = {
        key: uploadsConfig.key,
        secret: uploadsConfig.secret,
        bucket: uploadsConfig.bucket,
        s3ForcePathStyle: true
      }
      if (uploadsConfig.endpoint) adapterOpts.endpoint = uploadsConfig.endpoint
      if (uploadsConfig.region) adapterOpts.region = uploadsConfig.region
      const adapter = skipperS3(adapterOpts)

      await new Promise((resolve, reject) => {
        const readable = adapter.read(backup.s3Key)
        const writable = fs.createWriteStream(tmpFile)

        readable.on('error', (err) => reject(new Error(`S3 download failed: ${err.message}`)))
        writable.on('error', (err) => reject(new Error(`File write failed: ${err.message}`)))
        writable.on('finish', resolve)

        readable.pipe(writable)
      })

      const stats = fs.statSync(tmpFile)
      if (stats.size === 0) {
        throw new Error('Downloaded backup file is empty')
      }

      sails.log.info(`Backup downloaded: ${stats.size} bytes`)

      // 2. Restore into database container
      const dockerPath = sails.config.docker?.binaryPath || 'docker'
      const fileContent = fs.readFileSync(tmpFile)

      if (service.type === 'mongodb') {
        // MongoDB: pipe gzip archive through mongorestore via docker exec
        const mongoUri = `mongodb://${service.username}:${service.password}@localhost:27017/${service.database}?authSource=admin`
        await execRestore(dockerPath, [
          'exec', '-i', service.containerName,
          'mongorestore', '--uri', mongoUri, '--archive', '--gzip', '--drop'
        ], fileContent)
      } else if (service.type === 'postgresql') {
        // PostgreSQL: pipe SQL through psql
        await execRestore(dockerPath, [
          'exec', '-i',
          '-e', `PGPASSWORD=${service.password}`,
          service.containerName,
          'psql', '-U', service.username, '-d', service.database,
          '--no-psqlrc', '-v', 'ON_ERROR_STOP=1'
        ], fileContent)
      } else if (service.type === 'mysql') {
        // MySQL: pipe SQL through mysql
        await execRestore(dockerPath, [
          'exec', '-i', service.containerName,
          'mysql', '-u', service.username, `-p${service.password}`, service.database
        ], fileContent)
      } else {
        throw new Error(`Restore not supported for service type: ${service.type}`)
      }

      sails.log.info(`Backup ${backupId} restored successfully to ${service.containerName}`)

      return { success: true, backupId, serviceName: service.name }
    } finally {
      // Clean up temp file
      try { fs.unlinkSync(tmpFile) } catch { /* ignore */ }
    }
  }
}

/**
 * Execute a docker restore command, piping file content to stdin.
 */
function execRestore(dockerPath, args, inputBuffer) {
  return new Promise((resolve, reject) => {
    const proc = spawn(dockerPath, args, { timeout: 300000 })

    let stderr = ''
    proc.stderr.on('data', (data) => { stderr += data.toString() })

    proc.on('close', (code) => {
      if (code !== 0) {
        reject(new Error(`Restore failed (exit ${code}): ${stderr.trim()}`))
      } else {
        resolve()
      }
    })

    proc.on('error', (err) => {
      reject(new Error(`Restore process error: ${err.message}`))
    })

    proc.stdin.write(inputBuffer)
    proc.stdin.end()
  })
}
