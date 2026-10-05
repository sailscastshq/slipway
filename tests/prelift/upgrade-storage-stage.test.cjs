const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const os = require('node:os')
const Database = require('better-sqlite3')
const storage = require('../../api/lib/upgrade-storage-stage')
const { runBounded } = require('../../api/lib/upgrade-process')
async function fixture(run) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'upgrade-storage-'))
  const source = path.join(root, 'original')
  const directory = path.join(root, 'upgrades')
  fs.mkdirSync(source, { mode: 0o700 })
  fs.mkdirSync(directory, { mode: 0o700 })
  const db = new Database(path.join(source, 'session.db'))
  db.exec(
    "CREATE TABLE sessions(id TEXT, value TEXT); INSERT INTO sessions VALUES('fixture-session','synthetic-session')"
  )
  db.close()
  fs.mkdirSync(path.join(source, 'keys'))
  fs.writeFileSync(
    path.join(source, 'keys/private-key'),
    'synthetic-key-to-preserve',
    { mode: 0o600 }
  )
  try {
    await run({ source, directory, maxBytes: 1024 * 1024, timeoutMs: 10000 })
  } finally {
    fs.rmSync(root, { recursive: true, force: true })
  }
}
test('stage preserves session and private opaque files without changing original storage', () =>
  fixture(async (options) => {
    const before = storage.inspectStorage({
      ...options,
      directory: options.source
    })
    const stage = await runBounded({
      operation: 'stageStorage',
      input: options,
      timeoutMs: 10000
    })
    assert.equal(stage.copyHash, before.hash)
    assert.equal(storage.verifySource({ ...options, stage }), true)
    assert.equal(
      fs.readFileSync(
        path.join(stage.dataDirectory, 'keys/private-key'),
        'utf8'
      ),
      'synthetic-key-to-preserve'
    )
    assert.equal(fs.statSync(stage.dataDirectory).mode & 0o777, 0o700)
    assert.equal(
      fs.statSync(path.join(stage.dataDirectory, 'keys/private-key')).mode &
        0o777,
      0o600
    )
    const db = new Database(path.join(stage.dataDirectory, 'session.db'))
    assert.equal(
      db.prepare('SELECT value FROM sessions').get().value,
      'synthetic-session'
    )
    db.exec("UPDATE sessions SET value='candidate-only'")
    db.close()
    assert.equal(storage.verifySource({ ...options, stage }), true)
    assert.ok(!JSON.stringify(stage).includes('synthetic-session'))
    assert.ok(!JSON.stringify(stage).includes('synthetic-key-to-preserve'))
  }))
test('late original writes invalidate publication without restoring over either database', () =>
  fixture((options) => {
    const stage = storage.stageStorage(options)
    fs.writeFileSync(path.join(options.source, 'late-writer'), 'late-write')
    assert.throws(() => storage.verifySource({ ...options, stage }), {
      code: 'upgradeStorageMismatch'
    })
    assert.equal(
      fs.existsSync(path.join(stage.dataDirectory, 'late-writer')),
      false
    )
  }))
test('symlinks, byte overflow and recursive destination fail before publication', () =>
  fixture((options) => {
    fs.symlinkSync(
      path.join(options.source, 'session.db'),
      path.join(options.source, 'alias')
    )
    assert.throws(() => storage.stageStorage(options), {
      code: 'upgradeStorageMismatch'
    })
    fs.unlinkSync(path.join(options.source, 'alias'))
    assert.throws(() => storage.stageStorage({ ...options, maxBytes: 1 }), {
      code: 'upgradeStorageMismatch'
    })
    assert.throws(
      () => storage.stageStorage({ ...options, directory: options.source }),
      { code: 'upgradeStorageMismatch' }
    )
    assert.deepEqual(fs.readdirSync(options.directory), [])
  }))
