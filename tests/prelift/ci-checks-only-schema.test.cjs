const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const Database = require('better-sqlite3')
const migrations = require('../../api/lib/release-migrations').forCatalog(
  require('../../api/lib/releases/ci-checks-only-v1.json')
)
test('checks-only queue and reporting migration is additive, preflight-only until apply, and idempotent', async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'ci-checks-schema-'))
  const target = path.join(directory, 'app.db')
  try {
    const db = new Database(target)
    db.exec(
      "CREATE TABLE keep_me(value TEXT); INSERT INTO keep_me VALUES ('preserved')"
    )
    db.close()
    await migrations.run({ directory, preflightOnly: true })
    let read = new Database(target)
    assert.equal(
      read
        .prepare("SELECT count(*) AS n FROM sqlite_schema WHERE name='ci_jobs'")
        .get().n,
      0
    )
    read.close()
    await migrations.run({ directory })
    read = new Database(target)
    assert.equal(
      read.prepare('SELECT value FROM keep_me').get().value,
      'preserved'
    )
    assert.ok(
      read.prepare("SELECT name FROM sqlite_schema WHERE name='ci_jobs'").get()
    )
    assert.ok(
      read
        .prepare("SELECT name FROM sqlite_schema WHERE name='ci_reports'")
        .get()
    )
    assert.equal(read.pragma('integrity_check', { simple: true }), 'ok')
    read.close()
    const before = fs.readFileSync(target)
    assert.equal((await migrations.run({ directory })).migratedDatastores, 0)
    assert.deepEqual(fs.readFileSync(target), before)
  } finally {
    fs.rmSync(directory, { recursive: true, force: true })
  }
})
