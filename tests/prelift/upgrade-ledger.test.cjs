const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const Database = require('better-sqlite3')
const ledger = require('../../api/lib/upgrade-ledger')
function manifest() {
  return {
    format: 1,
    version: '0.0.88',
    image: `ghcr.io/sailscastshq/slipway@sha256:${'a'.repeat(64)}`,
    steps: [
      {
        id: 'app-v1',
        datastore: 'default',
        fromSchemaHash: 'b'.repeat(64),
        toSchemaHash: 'c'.repeat(64),
        operationsHash: 'd'.repeat(64)
      }
    ]
  }
}
test('manifest identity is stable across object order and deeply immutable', () => {
  const input = manifest()
  const first = ledger.createManifest(input)
  const reversed = Object.fromEntries(Object.entries(input).reverse())
  assert.equal(ledger.createManifest(reversed).hash, first.hash)
  input.steps[0].id = 'changed'
  assert.equal(first.manifest.steps[0].id, 'app-v1')
  assert.ok(Object.isFrozen(first.manifest.steps[0]))
  const changed = manifest()
  changed.steps[0].toSchemaHash = 'e'.repeat(64)
  assert.notEqual(ledger.createManifest(changed).hash, first.hash)
})
test('mutable images, duplicate steps, malformed hashes and broken chains fail closed', () => {
  const mutable = manifest()
  mutable.image = 'ghcr.io/sailscastshq/slipway:0.0.88'
  assert.throws(() => ledger.createManifest(mutable), /immutable image/)
  const duplicate = manifest()
  duplicate.steps.push({ ...duplicate.steps[0] })
  assert.throws(() => ledger.createManifest(duplicate), /duplicate/)
  const badHash = manifest()
  badHash.steps[0].operationsHash = 'unknown'
  assert.throws(() => ledger.createManifest(badHash), /invalid/)
  const chain = manifest()
  chain.steps.push({ ...chain.steps[0], id: 'app-v2' })
  assert.throws(() => ledger.createManifest(chain), /contiguous chain/)
  chain.steps[1].fromSchemaHash = chain.steps[0].toSchemaHash
  assert.equal(ledger.createManifest(chain).manifest.steps.length, 2)
})
test('native adoption hashes distinguish same-named constraints and indexes', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'upgrade-adoption-'))
  const filename = path.join(directory, 'app.db')
  const db = new Database(filename)
  const service = {
    type: 'sqlite',
    path: filename,
    transaction: { database: db }
  }
  try {
    db.exec(
      'CREATE TABLE records (id INTEGER PRIMARY KEY, value TEXT CHECK(length(value) < 20)); CREATE INDEX records_value ON records(value)'
    )
    const original = ledger.schemaHash(service)
    db.exec(
      'DROP INDEX records_value; CREATE INDEX records_value ON records(value DESC) WHERE value IS NOT NULL'
    )
    assert.notEqual(ledger.schemaHash(service), original)
    db.exec(
      'DROP INDEX records_value; CREATE INDEX records_value ON records(value)'
    )
    assert.equal(ledger.schemaHash(service), original)
    db.exec(
      'DROP TABLE records; CREATE TABLE records (id INTEGER PRIMARY KEY, value TEXT CHECK(length(value) < 40)); CREATE INDEX records_value ON records(value)'
    )
    assert.notEqual(ledger.schemaHash(service), original)
  } finally {
    db.close()
    fs.rmSync(directory, { recursive: true, force: true })
  }
})
test('reading an absent ledger is read-only and does not adopt any schema', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'upgrade-readonly-'))
  const filename = path.join(directory, 'app.db')
  const seed = new Database(filename)
  seed.exec('CREATE TABLE records (value TEXT)')
  seed.close()
  const bytes = fs.readFileSync(filename)
  const db = new Database(filename, { readonly: true })
  try {
    const identity = ledger.createManifest(manifest())
    assert.deepEqual(ledger.readLedger(db, identity, 'default', 'fixture'), [])
    assert.throws(
      () =>
        ledger.readLedger(
          db,
          { ...identity, hash: 'wrong' },
          'default',
          'fixture'
        ),
      /identity changed/
    )
    assert.deepEqual(fs.readFileSync(filename), bytes)
  } finally {
    db.close()
    fs.rmSync(directory, { recursive: true, force: true })
  }
})

test('a killed process leaves either the original schema or a complete durable checkpoint', () => {
  const { spawnSync } = require('node:child_process')
  const modulePath = require.resolve('../../api/lib/upgrade-ledger')
  for (const commit of [false, true]) {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'upgrade-kill-'))
    const filename = path.join(directory, 'app.db')
    const db = new Database(filename)
    const service = { path: filename, datastore: 'observability' }
    db.exec(
      "CREATE TABLE records (value TEXT); INSERT INTO records VALUES ('preserved')"
    )
    const fromSchemaHash = ledger.schemaHash(service)
    const selected = [
      {
        type: 'add_column',
        table: 'records',
        column: 'note',
        sql: 'ALTER TABLE records ADD COLUMN note TEXT'
      }
    ]
    db.exec('BEGIN IMMEDIATE')
    db.exec(selected[0].sql)
    const toSchemaHash = ledger.schemaHash({
      ...service,
      transaction: { database: db }
    })
    db.exec('ROLLBACK')
    db.close()
    const identity = ledger.createManifest({
      ...manifest(),
      steps: [
        {
          id: 'records-note',
          datastore: service.datastore,
          fromSchemaHash,
          toSchemaHash,
          operationsHash: ledger.digest(selected)
        }
      ]
    })
    const options = {
      identity,
      stepId: 'records-note',
      databaseKey: 'physical-fixture',
      fenceId: 'fixture-stop-proof',
      backupId: 'fixture-backup'
    }
    try {
      assert.equal(
        ledger.inspectState(service, identity, options.databaseKey).complete,
        false
      )
      const child = spawnSync(
        process.execPath,
        [
          '-e',
          `
        const fs = require('node:fs')
        const input = JSON.parse(fs.readFileSync(0, 'utf8'))
        const Database = require('better-sqlite3')
        const ledger = require(input.modulePath)
        const db = new Database(input.service.path)
        const readSchema = require(input.schemaPath)
        db.exec('BEGIN IMMEDIATE')
        const service = { ...input.service, transaction: { database: db } }
        const before = readSchema(service)
        db.exec(input.selected[0].sql)
        ledger.receiptWriter(input.options)({ database: db, service, before, entry: { selected: input.selected, payload: { target: { physicalKey: input.options.databaseKey } } } })
        if (input.commit) db.exec('COMMIT')
        process.kill(process.pid, 'SIGKILL')
      `
        ],
        {
          cwd: path.resolve(__dirname, '../..'),
          input: JSON.stringify({
            modulePath,
            schemaPath: require.resolve('../../api/lib/sqlite-schema'),
            service,
            selected,
            options,
            commit
          }),
          encoding: 'utf8'
        }
      )
      assert.equal(child.signal, 'SIGKILL', child.stderr)
      const state = ledger.inspectState(service, identity, options.databaseKey)
      assert.equal(state.complete, commit)
      assert.equal(state.receipts.length, commit ? 1 : 0)
      const check = new Database(filename)
      assert.equal(
        check.prepare('SELECT value FROM records').get().value,
        'preserved'
      )
      if (commit) {
        check.exec('ALTER TABLE records ADD COLUMN unexpected TEXT')
        assert.throws(
          () => ledger.inspectState(service, identity, options.databaseKey),
          /physical schema differs/
        )
      }
      check.close()
    } finally {
      fs.rmSync(directory, { recursive: true, force: true })
    }
  }
})
