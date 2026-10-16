const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs/promises')
const os = require('node:os')
const path = require('node:path')
const adapter = require('sails-sqlite')
const Database = require('better-sqlite3')
const { datastores } = require('../../../config/datastores')

for (const name of ['default', 'observability', 'analytics', 'cache']) {
  test(`${name} reaches the real adapter with mmap disabled and WAL reads/writes intact`, async (t) => {
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'slipway-mmap-'))
    const identity = `mmap-policy-${name}`
    let registered = false
    let other
    t.after(async () => {
      other?.close()
      if (registered)
        await new Promise((resolve, reject) =>
          adapter.teardown(identity, (error) =>
            error ? reject(error) : resolve()
          )
        )
      await fs.rm(directory, { recursive: true, force: true })
    })
    await new Promise((resolve, reject) =>
      adapter.registerDatastore(
        {
          ...datastores[name],
          identity,
          url: path.join(directory, 'fixture.db')
        },
        {},
        (error) => (error ? reject(error) : resolve())
      )
    )
    registered = true
    const db = adapter.datastores[identity].manager
    // Exercise actual registerDatastore forwarding: a config-only assertion would
    // miss an adapter dropping the numeric zero or misrouting pragma options.
    assert.equal(db.pragma('mmap_size', { simple: true }), 0)
    assert.equal(db.pragma('journal_mode', { simple: true }), 'wal')
    assert.equal(db.pragma('synchronous', { simple: true }), 1) // existing NORMAL
    db.exec('CREATE TABLE fixture (id INTEGER PRIMARY KEY, value TEXT)')
    db.prepare('INSERT INTO fixture(value) VALUES (?)').run('first connection')
    other = new Database(path.join(directory, 'fixture.db'))
    assert.equal(other.pragma('mmap_size', { simple: true }), 0)
    assert.equal(
      other.prepare('SELECT value FROM fixture WHERE id = 1').get().value,
      'first connection'
    )
    other
      .prepare('INSERT INTO fixture(value) VALUES (?)')
      .run('second connection')
    assert.deepEqual(
      db.prepare('SELECT value FROM fixture ORDER BY id').all(),
      [{ value: 'first connection' }, { value: 'second connection' }]
    )
    // Checkpoint only this disposable fixture, never an application database.
    const checkpoint = other.pragma('wal_checkpoint(TRUNCATE)')[0]
    assert.equal(checkpoint.busy, 0)
    assert.equal(
      db.prepare('SELECT COUNT(*) count FROM fixture').get().count,
      2
    )
    assert.equal(db.pragma('mmap_size', { simple: true }), 0)
  })
}
