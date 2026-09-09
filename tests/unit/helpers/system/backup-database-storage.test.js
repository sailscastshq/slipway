const { test } = require('sounding')
const fs = require('node:fs/promises')
const path = require('node:path')
const os = require('node:os')
const assert = require('node:assert/strict')
test('pre-update SQLite snapshots use the neutral backup pipeline and private temporary files', async ({
  sails
}) => {
  const root = await fs.mkdtemp(
    path.join(os.tmpdir(), 'slipway-system-storage-')
  )
  const appPath = sails.config.appPath
  const storage = sails.helpers.backup.getStorageConfig
  const upload = sails.helpers.backup.uploadObject
  let sourcePath
  try {
    await fs.mkdir(path.join(root, 'db'))
    const Database = require('better-sqlite3')
    const database = new Database(path.join(root, 'db/app.db'))
    database.exec(
      "CREATE TABLE example (name TEXT); INSERT INTO example VALUES ('retained')"
    )
    database.close()
    sails.config.appPath = root
    sails.helpers.backup.getStorageConfig = async () => ({
      provider: 'azure',
      bucket: 'private-backups'
    })
    const capture = async (input) => {
      sourcePath = input.sourcePath
      assert.equal((await fs.stat(sourcePath)).mode & 0o777, 0o600)
      const snapshot = new Database(sourcePath, { readonly: true })
      assert.equal(
        snapshot.prepare('SELECT name FROM example').get().name,
        'retained'
      )
      snapshot.close()
      assert.equal(input.storageConfig.provider, 'azure')
      return { checksum: 'fixture-checksum' }
    }
    capture.with = capture
    sails.helpers.backup.uploadObject = capture
    const result = await sails.helpers.system.backupDatabase()
    assert.equal(result.skipped, false, result.reason)
    assert.equal(result.s3Key, null)
    assert.ok(result.objectKey.startsWith('backups/slipway-system/'))
    assert.equal(await fs.stat(sourcePath).catch(() => null), null)
  } finally {
    sails.config.appPath = appPath
    sails.helpers.backup.getStorageConfig = storage
    sails.helpers.backup.uploadObject = upload
    await fs.rm(root, { recursive: true, force: true })
  }
})
