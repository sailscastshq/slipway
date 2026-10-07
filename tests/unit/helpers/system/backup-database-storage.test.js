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
    for (const file of [
      'app.db',
      'observability.db',
      'analytics.db',
      'stash.db'
    ]) {
      const database = new Database(path.join(root, 'db', file))
      database.exec(
        "CREATE TABLE example (name TEXT); INSERT INTO example VALUES ('retained')"
      )
      database.close()
    }
    sails.config.appPath = root
    sails.helpers.backup.getStorageConfig = async () => ({
      provider: 'azure',
      bucket: 'private-backups'
    })
    const capture = async (input) => {
      sourcePath = input.sourcePath
      assert.equal((await fs.stat(sourcePath)).mode & 0o777, 0o600)
      const snapshot = new Database(
        path.join(path.dirname(sourcePath), 'app.db'),
        { readonly: true }
      )
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
    assert.equal(result.localVerified, true)
    assert.ok((await fs.stat(sourcePath)).size > 0)
  } finally {
    sails.config.appPath = appPath
    sails.helpers.backup.getStorageConfig = storage
    sails.helpers.backup.uploadObject = upload
    await fs.rm(root, { recursive: true, force: true })
  }
})

test('failed remote uploads retain verified local recovery files, but corrupt storage blocks system backup', async ({
  sails
}) => {
  const root = await fs.mkdtemp(
    path.join(os.tmpdir(), 'slipway-system-failure-')
  )
  const appPath = sails.config.appPath
  const storage = sails.helpers.backup.getStorageConfig
  const upload = sails.helpers.backup.uploadObject
  try {
    await fs.mkdir(path.join(root, 'db'))
    const Database = require('better-sqlite3')
    for (const file of [
      'app.db',
      'observability.db',
      'analytics.db',
      'stash.db'
    ]) {
      const db = new Database(path.join(root, 'db', file))
      db.exec('CREATE TABLE example (id INTEGER PRIMARY KEY)')
      db.close()
    }
    sails.config.appPath = root
    sails.helpers.backup.getStorageConfig = async () => {
      throw new Error('not configured')
    }
    const result = await sails.helpers.system.backupDatabase()
    assert.equal(result.skipped, true)
    assert.equal(result.localVerified, true)
    assert.ok(
      (await fs.stat(path.join(result.localDirectory, 'system.tar.gz'))).size >
        0
    )
    await fs.writeFile(path.join(root, 'db/app.db'), 'broken SQLite')
    await assert.rejects(
      sails.helpers.system.backupDatabase(),
      /verification failed/
    )
  } finally {
    sails.config.appPath = appPath
    sails.helpers.backup.getStorageConfig = storage
    sails.helpers.backup.uploadObject = upload
    await fs.rm(root, { recursive: true, force: true })
  }
})

test('daily system verification retains a private report and notifies only when verification needs attention', async ({
  sails
}) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'slipway-system-check-'))
  const appPath = sails.config.appPath
  const notify = sails.helpers.notification.sendJobFailureNotification
  const notices = []
  const capture = (input) => ({ tolerate: async () => notices.push(input) })
  capture.with = capture
  try {
    await fs.mkdir(path.join(root, 'db'))
    const Database = require('better-sqlite3')
    for (const file of [
      'app.db',
      'observability.db',
      'analytics.db',
      'stash.db'
    ]) {
      const db = new Database(path.join(root, 'db', file))
      db.exec('CREATE TABLE fixture (id INTEGER PRIMARY KEY)')
      db.close()
    }
    sails.config.appPath = root
    sails.helpers.notification.sendJobFailureNotification = capture
    assert.equal((await sails.helpers.system.checkDatabaseStorage()).ok, true)
    assert.equal(notices.length, 0)
    await fs.writeFile(path.join(root, 'db/observability.db'), 'broken SQLite')
    assert.equal((await sails.helpers.system.checkDatabaseStorage()).ok, false)
    assert.equal(notices.length, 1)
    assert.match(notices[0].errorMessage, /observability.db/)
    assert.match(notices[0].errorMessage, /docs\/sqlite-recovery.md/)
    const reportPath = path.join(root, 'db/database-health.json')
    assert.equal((await fs.stat(reportPath)).mode & 0o777, 0o600)
    assert.equal(JSON.parse(await fs.readFile(reportPath, 'utf8')).ok, false)
  } finally {
    sails.config.appPath = appPath
    sails.helpers.notification.sendJobFailureNotification = notify
    await fs.rm(root, { recursive: true, force: true })
  }
})
