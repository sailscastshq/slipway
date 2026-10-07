const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const os = require('node:os')
const crypto = require('node:crypto')
const { execFileSync } = require('node:child_process')
const Database = require('better-sqlite3')
const doctor = require('../../bin/slipway-database.cjs')
const migrations = require('../../api/lib/release-migrations')
const legacy = require('./fixtures/legacy-production-ddl.json')

async function fixture(run) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'system-db-proof-'))
  const source = path.join(root, 'source')
  fs.mkdirSync(source)
  try {
    for (const [datastore, statements] of Object.entries(legacy.datastores)) {
      const db = new Database(path.join(source, migrations.files[datastore]))
      for (const sql of statements) db.exec(sql)
      if (datastore === 'observability')
        db.exec(
          "CREATE TABLE diagnostic_history(id INTEGER PRIMARY KEY, payload TEXT); INSERT INTO diagnostic_history VALUES(1, 'old history')"
        )
      if (datastore === 'default') {
        db.exec(
          "CREATE TABLE sqliteCustom(id INTEGER PRIMARY KEY, payload TEXT); INSERT INTO sqliteCustom VALUES(1,'also retained'); CREATE TABLE custom_data(id INTEGER PRIMARY KEY, payload TEXT); INSERT INTO custom_data VALUES(1,'retained'); CREATE VIEW custom_view AS SELECT * FROM custom_data; CREATE TRIGGER custom_trigger AFTER INSERT ON custom_data BEGIN UPDATE custom_data SET payload=payload WHERE id=new.id; END;"
        )
      }
      db.close()
    }
    return await run(root, source)
  } finally {
    fs.rmSync(root, { recursive: true, force: true })
  }
}

test('system archive verifies all four native snapshots and hashes their contents', () =>
  fixture(async (root, source) => {
    const output = path.join(root, 'backup')
    const result = await doctor.bundle(source, output)
    assert.equal(result.manifest.databases.length, 4)
    for (const item of result.manifest.databases) {
      assert.equal(
        item.sha256,
        crypto
          .createHash('sha256')
          .update(fs.readFileSync(path.join(output, item.file)))
          .digest('hex')
      )
      assert.equal(
        fs.statSync(path.join(output, item.file)).mode & 0o777,
        0o600
      )
    }
    assert.match(
      execFileSync('tar', ['-tzf', result.archive], { encoding: 'utf8' }),
      /manifest.json/
    )
    const extract = path.join(root, 'extracted')
    fs.mkdirSync(extract)
    execFileSync('tar', ['-xzf', result.archive, '-C', extract])
    for (const item of result.manifest.databases)
      assert.deepEqual(
        fs.readFileSync(path.join(output, item.file)),
        fs.readFileSync(path.join(extract, item.file))
      )
  }))

test('native parity rejects altered application rows and schema before any live replacement', () =>
  fixture(async (root, source) => {
    const target = path.join(root, 'candidate.db')
    await doctor.snapshot(path.join(source, 'app.db'), target)
    assert.ok(
      doctor
        .parity(path.join(source, 'app.db'), target)
        .some((item) => item.table === 'custom_data' && item.rows === 1)
    )
    let db = new Database(target)
    db.exec("UPDATE sqliteCustom SET payload='changed'")
    db.close()
    assert.throws(
      () => doctor.parity(path.join(source, 'app.db'), target),
      /table differs: sqliteCustom/
    )
    db = new Database(target)
    db.exec("UPDATE sqliteCustom SET payload='also retained'")
    db.exec("UPDATE custom_data SET payload='changed'")
    db.close()
    assert.throws(
      () => doctor.parity(path.join(source, 'app.db'), target),
      /table differs/
    )
    db = new Database(target)
    db.exec('DROP VIEW custom_view')
    db.close()
    assert.throws(
      () => doctor.parity(path.join(source, 'app.db'), target),
      /schema differs/
    )
    db = new Database(path.join(source, 'app.db'))
    db.exec('CREATE TABLE lost_and_found (payload TEXT)')
    db.close()
    assert.throws(
      () => doctor.parity(path.join(source, 'app.db'), target),
      /already contains lost_and_found/
    )
  }))

test('snapshot verification reports corruption without treating the backup as healthy', () =>
  fixture(async (root, source) => {
    const original = path.join(source, 'app.db')
    fs.writeFileSync(original, Buffer.from('not a SQLite database'))
    const result = await doctor.check(source)
    assert.equal(result.ok, false)
    assert.equal(
      result.results.find((item) => item.database === 'app.db').ok,
      false
    )
    assert.equal(
      result.results.find((item) => item.database === 'analytics.db').ok,
      true
    )
  }))

test(
  'offline recovery keeps custom data, resets only observability history, and migrates valid candidates',
  { skip: !process.env.SQLITE_RECOVERY_TOOL },
  () =>
    fixture(async (root, source) => {
      const original = path.join(source, 'app.db')
      const tool = process.env.SQLITE_RECOVERY_TOOL
      execFileSync(tool, [original, 'ANALYZE'])
      const page = Number(
        execFileSync(
          tool,
          [
            original,
            "SELECT rootpage FROM sqlite_schema WHERE name='sqlite_stat4'"
          ],
          { encoding: 'utf8' }
        )
      )
      const pageSize = Number(
        execFileSync(tool, [original, 'PRAGMA page_size'], { encoding: 'utf8' })
      )
      assert.ok(page > 0)
      const fd = fs.openSync(original, 'r+')
      fs.writeSync(fd, Buffer.from([0]), 0, 1, (page - 1) * pageSize)
      fs.closeSync(fd)
      const bytes = fs.readFileSync(original)
      const output = path.join(root, 'candidate')
      await assert.rejects(
        doctor.prepare({ source, output, sqlite: tool }),
        /Explicit/
      )
      const result = await doctor.prepare({
        source,
        output,
        sqlite: tool,
        resetObservability: true
      })
      assert.equal(result.observabilityReset, true)
      const empty = new Database(path.join(output, 'observability.db'))
      assert.equal(
        empty.prepare('SELECT count(*) AS count FROM diagnostic_history').get()
          .count,
        0
      )
      empty.close()
      assert.deepEqual(fs.readFileSync(original), bytes)
      await assert.rejects(
        doctor.prepare({
          source,
          output,
          sqlite: tool,
          resetObservability: true
        }),
        /EEXIST/
      )
      const migrated = await migrations.run({ directory: output })
      assert.equal(migrated.mode, 'applied')
      assert.equal((await doctor.check(output)).ok, true)
      for (const [datastore, file] of Object.entries(migrations.files))
        assert.equal(
          migrations.current({ datastore, path: path.join(output, file) }),
          true
        )
    })
)

test('ORM, cache, session store and system helpers use one patched SQLite library', () => {
  const root = require.resolve('better-sqlite3')
  for (const consumer of [
    'sails-sqlite',
    'sails-stash',
    '@sailscastshq/connect-sqlite'
  ])
    assert.equal(
      require.resolve('better-sqlite3', { paths: [require.resolve(consumer)] }),
      root
    )
  const db = new Database(':memory:')
  try {
    const version = db
      .prepare('SELECT sqlite_version() AS version')
      .get()
      .version.split('.')
      .map(Number)
    assert.ok(
      version[0] > 3 ||
        (version[0] === 3 &&
          (version[1] > 51 || (version[1] === 51 && version[2] >= 3)))
    )
  } finally {
    db.close()
  }
})

test('interrupted operator replacement blocks startup until retained originals are reviewed', () =>
  fixture(async (root, source) => {
    fs.writeFileSync(
      path.join(source, '.slipway-recovery-in-progress'),
      'private recovery directory'
    )
    const startup = require('../../api/lib/release-startup')
    await assert.rejects(
      startup.beforeLift({ directory: source, role: 'startup' }),
      /operator database recovery was interrupted/
    )
  }))

test(
  'large healthy observability storage migrates with preserved rows and bounded recovery backups',
  { skip: process.env.SLIPWAY_LARGE_DATABASE_PROOF !== '1', timeout: 360000 },
  () =>
    fixture(async (root, source) => {
      const filename = path.join(source, 'observability.db')
      const db = new Database(filename)
      const count = 3400000
      try {
        db.exec(`WITH RECURSIVE samples(n) AS (VALUES(1) UNION ALL SELECT n+1 FROM samples WHERE n<${count})
      INSERT INTO container_metrics(created_at, updated_at, container_name, container_type, recorded_at, net_io)
      SELECT n, n, 'synthetic-app', 'app', n, '${'x'.repeat(
        256
      )}' FROM samples`)
      } finally {
        db.close()
      }
      const sourceBytes = fs.statSync(filename).size
      assert.ok(sourceBytes > 512 * 1024 * 1024)
      const started = performance.now()
      const result = await migrations.run({ directory: source })
      const verified = new Database(filename, { readonly: true })
      try {
        doctor.verify(verified)
        assert.equal(
          verified
            .prepare(
              'SELECT count(*) AS count FROM container_metrics NOT INDEXED'
            )
            .get().count,
          count
        )
      } finally {
        verified.close()
      }
      assert.equal(result.mode, 'applied')
      console.log(
        JSON.stringify({
          syntheticLargeDatabase: {
            rows: count,
            sourceBytes,
            elapsedMs: performance.now() - started,
            timings: result.timings
          }
        })
      )
    })
)
