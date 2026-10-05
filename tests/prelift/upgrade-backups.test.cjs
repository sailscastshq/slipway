const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const Database = require('better-sqlite3')
const {
  createBackupSet,
  verifyBackupSet
} = require('../../api/lib/upgrade-backups')
async function fixture(run) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'upgrade-backups-'))
  const databases = ['default', 'observability', 'analytics', 'cache'].map(
    (datastore) => {
      const filename = path.join(directory, `${datastore}.db`)
      const db = new Database(filename)
      db.exec(
        "CREATE TABLE records (id INTEGER PRIMARY KEY, value TEXT CHECK(length(value) < 100)); INSERT INTO records VALUES (1, 'protected'); CREATE INDEX records_value ON records(value DESC) WHERE value IS NOT NULL; CREATE VIEW visible AS SELECT value FROM records"
      )
      db.close()
      return { datastore, path: filename, databaseKey: `fixture:${datastore}` }
    }
  )
  const originals = databases.map((source) => fs.readFileSync(source.path))
  const options = {
    databases,
    directory,
    maxBytes: 10 * 1024 * 1024,
    reserveBytes: 0,
    timeoutMs: 10000,
    verifyFence: async () => ({
      id: 'all-fixture-writers-stopped',
      writersStopped: true,
      databaseKeys: databases.map((source) => source.databaseKey)
    })
  }
  try {
    await run({ directory, databases, options, originals })
  } finally {
    fs.rmSync(directory, { recursive: true, force: true })
  }
}
test('every owned datastore has a private durable verified snapshot before mutation', () =>
  fixture(async ({ options, originals, databases }) => {
    const set = await createBackupSet(options)
    assert.equal(set.receipt.snapshots.length, 4)
    assert.equal(fs.statSync(set.directory).mode & 0o777, 0o700)
    const receipt = await verifyBackupSet(set, 10000)
    assert.deepEqual(receipt, set.receipt)
    for (const snapshot of receipt.snapshots) {
      const db = new Database(path.join(set.directory, snapshot.file), {
        readonly: true
      })
      assert.equal(
        db.prepare('SELECT value FROM records').get().value,
        'protected'
      )
      assert.ok(
        db
          .prepare("SELECT sql FROM sqlite_schema WHERE name = 'records_value'")
          .get()
          .sql.includes('DESC')
      )
      db.close()
    }
    databases.forEach((source, index) =>
      assert.deepEqual(fs.readFileSync(source.path), originals[index])
    )
  }))
test('missing databases and incomplete writer fences cannot authorize backup or DDL', () =>
  fixture(async ({ options, directory }) => {
    await assert.rejects(
      () => createBackupSet({ ...options, verifyFence: undefined }),
      /writer fence/
    )
    await assert.rejects(
      () =>
        createBackupSet({
          ...options,
          verifyFence: async () => ({ id: 'lease-only', writersStopped: false })
        }),
      /writer fence/
    )
    await assert.rejects(
      () =>
        createBackupSet({
          ...options,
          databases: [
            ...options.databases,
            { datastore: 'default', path: '/missing', databaseKey: 'missing' }
          ]
        }),
      /duplicated/
    )
    fs.rmSync(options.databases[2].path)
    await assert.rejects(() => createBackupSet(options), /ENOENT/)
    assert.equal(
      fs
        .readdirSync(directory)
        .some((file) => file.startsWith('slipway-upgrade-')),
      false
    )
  }))
test('losing the fence removes the incomplete set and preserves all live databases', () =>
  fixture(async ({ options, originals, databases, directory }) => {
    let calls = 0
    await assert.rejects(
      () =>
        createBackupSet({
          ...options,
          verifyFence: async () => ({
            id: ++calls < 3 ? 'first-owner' : 'different-owner',
            writersStopped: true,
            databaseKeys: databases.map((source) => source.databaseKey)
          })
        }),
      /writer fence/
    )
    assert.equal(
      fs
        .readdirSync(directory)
        .some((file) => file.startsWith('slipway-upgrade-')),
      false
    )
    databases.forEach((source, index) =>
      assert.deepEqual(fs.readFileSync(source.path), originals[index])
    )
  }))
test('size bounds and corruption fail before producing a complete set', () =>
  fixture(async ({ options, directory }) => {
    await assert.rejects(
      () => createBackupSet({ ...options, maxBytes: 1 }),
      /size limit/
    )
    fs.writeFileSync(options.databases[1].path, 'corrupt fixture database')
    await assert.rejects(() => createBackupSet(options), /not a database/)
    assert.equal(
      fs
        .readdirSync(directory)
        .some((file) => file.startsWith('slipway-upgrade-')),
      false
    )
  }))
test('backup revalidation rejects data tampering even when schema and counts match', () =>
  fixture(async ({ options }) => {
    const set = await createBackupSet(options)
    const filename = path.join(set.directory, set.receipt.snapshots[0].file)
    const db = new Database(filename)
    db.exec("UPDATE records SET value = 'changed'")
    db.close()
    await assert.rejects(
      () => verifyBackupSet(set, 10000),
      /backup file changed/
    )
  }))

test('an unresponsive fence verifier cannot hold the backup open indefinitely', () =>
  fixture(async ({ options, directory }) => {
    await assert.rejects(
      () =>
        createBackupSet({
          ...options,
          timeoutMs: 20,
          verifyFence: () => new Promise(() => {})
        }),
      /deadline/
    )
    assert.equal(
      fs
        .readdirSync(directory)
        .some((file) => file.startsWith('slipway-upgrade-')),
      false
    )
  }))
