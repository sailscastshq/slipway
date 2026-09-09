const fs = require('fs')
const path = require('path')
const os = require('os')
const { randomUUID } = require('node:crypto')

module.exports = {
  friendlyName: 'Backup database',

  description:
    'Create a pre-update snapshot of app.db and upload it to private backup storage. Never throws — skips gracefully if storage is not configured or on any error.',

  inputs: {},

  exits: {
    success: {
      outputType: 'ref'
    }
  },

  fn: async function () {
    const dbPath = path.resolve(sails.config.appPath, 'db', 'app.db')
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-')
    const tmpFile = path.join(
      os.tmpdir(),
      `slipway-pre-update-${timestamp}-${randomUUID()}.db`
    )

    let ownsFile = false
    try {
      const storageConfig = await sails.helpers.backup.getStorageConfig()

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
        const reserved = await fs.promises.open(tmpFile, 'wx', 0o600)
        ownsFile = true
        await reserved.close()
        await db.backup(tmpFile)
      } finally {
        db.close()
      }

      const objectKey = `backups/slipway-system/${timestamp}-${randomUUID()}.db`
      const sizeBytes = fs.statSync(tmpFile).size
      const limits = sails.config.custom.databaseOperations
      const metadata = await sails.helpers.backup.uploadObject.with({
        sourcePath: tmpFile,
        objectKey,
        sizeBytes,
        storageConfig,
        maxBytes: limits.backupMaxBytes,
        timeoutMs: limits.backupTimeoutMs
      })
      sails.log.info(
        `[slipway] Pre-update backup uploaded: ${objectKey} (${sizeBytes} bytes)`
      )
      return {
        skipped: false,
        objectKey,
        s3Key: storageConfig.provider === 'azure' ? null : objectKey,
        provider: storageConfig.provider,
        container: storageConfig.bucket,
        sizeBytes,
        ...metadata
      }
    } catch (err) {
      sails.log.warn(
        `[slipway] Pre-update backup failed (update will continue): ${err.message}`
      )
      return { skipped: true, reason: err.message }
    } finally {
      try {
        if (ownsFile) fs.unlinkSync(tmpFile)
      } catch {
        /* ignore */
      }
    }
  }
}
