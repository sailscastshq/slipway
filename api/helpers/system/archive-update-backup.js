const fs = require('node:fs/promises')
const path = require('node:path')
const { randomUUID } = require('node:crypto')
module.exports = {
  friendlyName: 'Archive update backup',
  description:
    'Retry one verified updater bundle through the existing private storage adapters.',
  inputs: {},
  exits: { success: { outputType: 'ref' } },
  fn: async function () {
    const root = path.join(sails.config.appPath, 'db/system-backups')
    let entries
    try {
      entries = await fs.readdir(root, { withFileTypes: true })
    } catch (error) {
      if (error.code === 'ENOENT') return { pending: false }
      throw error
    }
    for (const entry of entries.filter(
      (entry) => entry.isDirectory() && /^[a-f0-9-]{36}$/.test(entry.name)
    )) {
      const directory = path.join(root, entry.name),
        marker = path.join(directory, 'remote-pending.json')
      let pending
      try {
        pending = JSON.parse(await fs.readFile(marker, 'utf8'))
      } catch (error) {
        if (error.code === 'ENOENT') continue
        throw error
      }
      if (pending.nextAttemptAt > Date.now()) continue
      const output = path.join(directory, 'remote.json')
      try {
        await fs.access(output)
        await fs.unlink(marker)
        continue
      } catch (error) {
        if (error.code !== 'ENOENT') throw error
      }
      const limits = sails.config.custom.databaseOperations
      try {
        const manifest = JSON.parse(
          await fs.readFile(path.join(directory, 'manifest.json'), 'utf8')
        )
        if (
          manifest.databases?.length !== 4 ||
          manifest.databases.some(
            (db) => db.integrity !== 'ok' || db.foreignKeys !== 'ok'
          )
        )
          throw Error('Unverified updater snapshot')
        const archive = path.join(directory, 'system.tar.gz'),
          stat = await fs.lstat(archive)
        if (
          !stat.isFile() ||
          stat.size < 1 ||
          stat.size > limits.backupMaxBytes
        )
          throw Error('Invalid updater archive')
        const storageConfig = await sails.helpers.backup.getStorageConfig()
        const objectKey = `backups/slipway-system/${entry.name}.tar.gz`
        await sails.helpers.backup.uploadObject.with({
          sourcePath: archive,
          objectKey,
          sizeBytes: stat.size,
          storageConfig,
          maxBytes: limits.backupMaxBytes,
          timeoutMs: Math.min(limits.backupTimeoutMs, 300000)
        })
        const temporary = output + '.' + randomUUID()
        await fs.writeFile(
          temporary,
          JSON.stringify({
            objectKey,
            provider: storageConfig.provider,
            container: storageConfig.bucket,
            completedAt: new Date().toISOString()
          }),
          { mode: 0o600 }
        )
        await fs.rename(temporary, output)
        await fs.unlink(marker)
        return { archived: true, objectKey }
      } catch {
        // Keep private copies and retry on the next day rather than producing a
        // notification loop for installations without remote storage configured.
        const temporary = marker + '.' + randomUUID()
        await fs.writeFile(
          temporary,
          JSON.stringify({ version: 1, nextAttemptAt: Date.now() + 86400000 }),
          { mode: 0o600 }
        )
        await fs.rename(temporary, marker)
        sails.log.warn(
          '[slipway] Remote update backup unavailable; verified local snapshots are retained. Check Settings → File storage → Backup storage. Archival will retry tomorrow.'
        )
        return { pending: true, archived: false }
      }
    }
    return { pending: false }
  }
}
