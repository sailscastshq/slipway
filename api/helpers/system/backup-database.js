const fs = require('fs')
const path = require('path')
const os = require('os')

module.exports = {
  friendlyName: 'Backup database',

  description:
    'Create a pre-update snapshot of app.db and upload it to S3-compatible storage. Never throws — skips gracefully if S3 is not configured or on any error.',

  inputs: {},

  exits: {
    success: {
      outputType: 'ref'
    }
  },

  fn: async function () {
    const dbPath = path.resolve(sails.config.appPath, 'db', 'app.db')
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-')
    const tmpFile = path.join(os.tmpdir(), `slipway-pre-update-${timestamp}.db`)

    try {
      // 1. Resolve S3 credentials (same pattern as run-backup.js lines 38-51)
      let globalEnvVars = {}
      try {
        const globalJson = await sails.helpers.setting.get(
          'globalEnvVars',
          '{}'
        )
        globalEnvVars = JSON.parse(globalJson)
      } catch {
        /* ignore */
      }

      const uploadsConfig = {
        key:
          globalEnvVars.R2_ACCESS_KEY ||
          globalEnvVars.S3_ACCESS_KEY ||
          globalEnvVars.SPACES_ACCESS_KEY ||
          (sails.config.uploads || {}).key,
        secret:
          globalEnvVars.R2_SECRET_KEY ||
          globalEnvVars.S3_SECRET_KEY ||
          globalEnvVars.SPACES_SECRET_KEY ||
          (sails.config.uploads || {}).secret,
        bucket:
          globalEnvVars.R2_BUCKET ||
          globalEnvVars.S3_BUCKET ||
          globalEnvVars.SPACES_BUCKET ||
          (sails.config.uploads || {}).bucket,
        endpoint:
          globalEnvVars.R2_ENDPOINT ||
          globalEnvVars.S3_ENDPOINT ||
          globalEnvVars.SPACES_ENDPOINT ||
          (sails.config.uploads || {}).endpoint,
        region:
          globalEnvVars.S3_REGION ||
          globalEnvVars.SPACES_REGION ||
          (sails.config.uploads || {}).region
      }

      if (
        !uploadsConfig.key ||
        !uploadsConfig.secret ||
        !uploadsConfig.bucket
      ) {
        sails.log.info(
          '[slipway] Skipping pre-update backup — S3 storage not configured'
        )
        return { skipped: true, reason: 'S3 not configured' }
      }

      // 2. Create a consistent SQLite snapshot via better-sqlite3's backup API
      if (!fs.existsSync(dbPath)) {
        sails.log.info(
          '[slipway] Skipping pre-update backup — database file not found'
        )
        return { skipped: true, reason: 'Database file not found' }
      }

      const Database = require('better-sqlite3')
      const db = new Database(dbPath, { readonly: true })
      try {
        await db.backup(tmpFile)
      } finally {
        db.close()
      }

      // 3. Upload the snapshot to S3
      const s3Key = `backups/slipway-system/${timestamp}.db`
      const stats = fs.statSync(tmpFile)
      const sizeBytes = stats.size

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
        const receiver = adapter.receive({ dirname: '', saveAs: s3Key })
        const readStream = fs.createReadStream(tmpFile)

        readStream.skipperFd = s3Key
        readStream.fd = s3Key
        readStream.filename = path.basename(s3Key)
        readStream.headers = { 'content-type': 'application/octet-stream' }
        readStream.byteCount = sizeBytes

        readStream.pipe(receiver)

        receiver.on('finish', () => resolve())
        receiver.on('error', (err) => reject(err))
      })

      sails.log.info(
        `[slipway] Pre-update backup uploaded: ${s3Key} (${sizeBytes} bytes)`
      )
      return { skipped: false, s3Key, sizeBytes }
    } catch (err) {
      sails.log.warn(
        `[slipway] Pre-update backup failed (update will continue): ${err.message}`
      )
      return { skipped: true, reason: err.message }
    } finally {
      try {
        fs.unlinkSync(tmpFile)
      } catch {
        /* ignore */
      }
    }
  }
}
