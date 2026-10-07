const fs = require('node:fs')
const path = require('node:path')
const { randomUUID } = require('node:crypto')
const { execFile } = require('node:child_process')
const { promisify } = require('node:util')
const exec = promisify(execFile)

module.exports = {
  friendlyName: 'Backup database',
  description:
    'Retain verified snapshots of every Slipway datastore, optionally uploading a private archive.',
  inputs: {},
  exits: { success: { outputType: 'ref' } },
  fn: async function () {
    const directory = path.resolve(sails.config.appPath, 'db')
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-')
    const root = path.join(directory, 'system-backups')
    await fs.promises.mkdir(root, { recursive: true, mode: 0o700 })
    const output = path.join(root, `${timestamp}-${randomUUID()}`)
    const limits = sails.config.custom.databaseOperations
    await sails.helpers.streams.getDiskCapacity.with({
      directory: root,
      maxBytes: limits.backupMaxBytes,
      reserveBytes: limits.minFreeDiskBytes,
      expectedBytes:
        (
          await Promise.all(
            ['app.db', 'observability.db', 'analytics.db', 'stash.db'].map(
              async (file) =>
                (
                  await fs.promises.stat(path.join(directory, file))
                ).size
            )
          )
        ).reduce((sum, bytes) => sum + bytes, 0) * 3
    })
    let snapshot
    try {
      // Native verification runs in an isolated process, keeping the dashboard responsive.
      const { stdout } = await exec(
        process.execPath,
        [
          path.resolve(__dirname, '../../../bin/slipway-database.cjs'),
          'snapshot',
          '--directory',
          directory,
          '--output',
          output
        ],
        { timeout: 300000, killSignal: 'SIGKILL', maxBuffer: 128 * 1024 }
      )
      snapshot = JSON.parse(stdout)
    } catch {
      // Keep partial files for diagnosis, but never advertise them as verified.
      throw new Error(
        'System backup verification failed. Update stopped; inspect database integrity, disk space and db/system-backups before retrying. See docs/sqlite-recovery.md.'
      )
    }
    let storageConfig
    try {
      storageConfig = await sails.helpers.backup.getStorageConfig()
      const objectKey = `backups/slipway-system/${timestamp}-${randomUUID()}.tar.gz`
      const sizeBytes = (await fs.promises.stat(snapshot.archive)).size
      const metadata = await sails.helpers.backup.uploadObject.with({
        sourcePath: snapshot.archive,
        objectKey,
        sizeBytes,
        storageConfig,
        maxBytes: limits.backupMaxBytes,
        timeoutMs: Math.min(limits.backupTimeoutMs, 300000)
      })
      return {
        skipped: false,
        localVerified: true,
        localDirectory: output,
        objectKey,
        s3Key: storageConfig.provider === 'azure' ? null : objectKey,
        provider: storageConfig.provider,
        container: storageConfig.bucket,
        sizeBytes,
        ...metadata
      }
    } catch {
      sails.log.warn(
        '[slipway] Remote system backup unavailable; verified local snapshots retained under db/system-backups. Check Settings → File storage → Backup storage.'
      )
      return {
        skipped: true,
        localVerified: true,
        localDirectory: output,
        reason:
          'Remote backup unavailable; verified local recovery snapshots retained.'
      }
    }
  }
}
