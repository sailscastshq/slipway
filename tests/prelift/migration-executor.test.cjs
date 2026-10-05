// Run with node --test. No Sails app, hooks, globals, ORM, or credentials.
const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const Database = require('better-sqlite3')
const createExecutor = require('../../api/lib/migration-executor')
const plans = require('../../api/lib/migration-plans')
const ledger = require('../../api/lib/upgrade-ledger')
const readSchema = require('../../api/lib/sqlite-schema')
const getSchema = async ({ service }) => readSchema(service)
const generateDiff = require('../../api/helpers/dock/generate-diff').fn
const generateSql = require('../../api/helpers/dock/generate-migration-sql').fn
const applySqliteMigration =
  require('../../api/helpers/dock/apply-sqlite-migration').fn

async function fixture(run) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'slipway-prelift-'))
  const filename = path.join(directory, 'app.db')
  const seed = new Database(filename)
  seed.exec(
    "CREATE TABLE notes (id INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL, title TEXT); INSERT INTO notes(title) VALUES ('preserved')"
  )
  seed.close()
  const service = { type: 'sqlite', path: filename, datastore: 'observability' }
  const target = {
    kind: 'bosun',
    key: 'bosun:app',
    physicalKey: `sqlite:${fs.realpathSync(filename)}`
  }
  const source = { release: 'fixture-v1' }
  const models = {
    note: {
      tableName: 'notes',
      primaryKey: 'id',
      attributes: {
        id: { type: 'number', autoIncrement: true },
        title: { type: 'string' },
        note: { type: 'string' }
      }
    }
  }
  const schema = (await getSchema({ service })).tables
  const diff = await generateDiff({ models, schema, dbType: 'sqlite' })
  const statements = (
    await generateSql({ diff, dbType: 'sqlite', models, schema })
  ).statements
  assert.ok(statements.length)
  const selected = statements.map((statement, index) => ({
    ...statement,
    operationId: `fixture-${index}`
  }))
  let releases = 0
  const entry = {
    id: 'prelift-fixture',
    hash: 'fixture-reviewed-hash',
    payload: {
      target,
      modelHash: plans.digest(models),
      sourceHash: plans.digest(source),
      schemaHash: plans.digest(schema),
      statements
    },
    selected,
    tables: new Set(selected.map((item) => item.table)),
    release: () => releases++
  }
  const events = []
  const adapters = {
    context: {
      refresh: async () => ({ service, target, source, models }),
      refreshVersion: async () => source
    },
    audit: async (_, action) => {
      events.push(action)
    },
    getSchema: (service) => getSchema({ service }),
    generateDiff: (models, schema, dbType) =>
      generateDiff({ models, schema, dbType }),
    generateMigrationSql: (diff, dbType, models, schema) =>
      generateSql({ diff, dbType, models, schema }),
    applySqliteMigration,
    executeSql: async () => {
      throw new Error('SQLite must use its locked connection')
    },
    openPostgresSession: () => {
      throw new Error('Unexpected PostgreSQL session')
    }
  }
  try {
    await run({
      adapters,
      entry,
      filename,
      service,
      events,
      releases: () => releases
    })
  } finally {
    fs.rmSync(directory, { recursive: true, force: true })
  }
}

function inspect(filename) {
  const db = new Database(filename)
  try {
    return {
      columns: db.pragma('table_info(notes)').map((row) => row.name),
      rows: db.prepare('SELECT id, title FROM notes').all(),
      integrity: db.pragma('integrity_check', { simple: true })
    }
  } finally {
    db.close()
  }
}

test('the same executor migrates a real database before Sails or ORM exists', () =>
  fixture(async ({ adapters, entry, filename, events, releases }) => {
    assert.equal(global.sails, undefined)
    assert.equal(global.AuditLog, undefined)
    const result = await createExecutor(adapters)({
      entry,
      actor: { id: 1, team: 1 }
    })
    assert.equal(result.success, true)
    assert.equal(result.verified, true)
    assert.deepEqual(inspect(filename), {
      columns: ['id', 'title', 'note'],
      rows: [{ id: 1, title: 'preserved' }],
      integrity: 'ok'
    })
    assert.deepEqual(events, [
      'migration.started',
      'migration.verified',
      'migration.applied'
    ])
    assert.equal(releases(), 1)
  }))

test('postflight failure rolls back and always releases the plan', () =>
  fixture(async ({ adapters, entry, filename, releases }) => {
    const diff = adapters.generateDiff
    let calls = 0
    adapters.generateDiff = async (...args) =>
      ++calls === 2 ? { state: 'unverified' } : diff(...args)
    const result = await createExecutor(adapters)({
      entry,
      actor: { id: 1, team: 1 }
    })
    assert.equal(result.success, false)
    assert.equal(result.outcome, 'rolledBack')
    assert.equal(result.code, 'migrationPostflightMismatch')
    assert.deepEqual(inspect(filename).columns, ['id', 'title'])
    assert.equal(releases(), 1)
  }))

test('a failed final audit reports committed changes without claiming rollback', () =>
  fixture(async ({ adapters, entry, filename, releases }) => {
    adapters.audit = async (_, action) => {
      if (action === 'migration.applied') throw new Error('audit unavailable')
    }
    const result = await createExecutor(adapters)({
      entry,
      actor: { id: 1, team: 1 }
    })
    assert.equal(result.success, false)
    assert.equal(result.outcome, 'committedAuditIncomplete')
    assert.equal(result.executed, entry.selected.length)
    assert.ok(inspect(filename).columns.includes('note'))
    assert.equal(releases(), 1)
  }))

test('source identity changes fail before commit and preserve data', () =>
  fixture(async ({ adapters, entry, filename }) => {
    adapters.context.refreshVersion = async () => ({ release: 'different' })
    const result = await createExecutor(adapters)({
      entry,
      actor: { id: 1, team: 1 }
    })
    assert.equal(result.success, false)
    assert.equal(result.outcome, 'rolledBack')
    assert.deepEqual(inspect(filename).columns, ['id', 'title'])
    assert.equal(inspect(filename).rows[0].title, 'preserved')
  }))

test('missing adapters fail before opening a database', () => {
  assert.throws(() => createExecutor({}), /Missing migration adapter: audit/)
})

test('high-risk plans keep a private integrity-checked recovery backup', () =>
  fixture(async ({ adapters, entry, filename }) => {
    entry.selected[0].risk = 'high'
    const result = await createExecutor(adapters)({
      entry,
      actor: { id: 1, team: 1 }
    })
    assert.equal(result.success, true)
    const backupPath = path.join(
      path.dirname(filename),
      'migration-backups',
      `${entry.id}.sqlite`
    )
    assert.equal(fs.statSync(backupPath).mode & 0o777, 0o600)
    assert.deepEqual(inspect(backupPath), {
      columns: ['id', 'title'],
      rows: [{ id: 1, title: 'preserved' }],
      integrity: 'ok'
    })
  }))

test('drift from the reviewed schema fails before executing DDL', () =>
  fixture(async ({ adapters, entry, filename, releases }) => {
    const drift = new Database(filename)
    drift.exec('ALTER TABLE notes ADD COLUMN drift TEXT')
    drift.close()
    const result = await createExecutor(adapters)({
      entry,
      actor: { id: 1, team: 1 }
    })
    assert.equal(result.success, false)
    assert.equal(result.code, 'staleMigrationPlan')
    assert.equal(result.outcome, 'rolledBack')
    assert.deepEqual(inspect(filename).columns, ['id', 'title', 'drift'])
    assert.equal(releases(), 1)
  }))

test('transactional audit failure rolls back verified changes', () =>
  fixture(async ({ adapters, entry, filename, releases }) => {
    adapters.audit = async (_, action) => {
      if (action === 'migration.verified')
        throw new Error('transactional audit unavailable')
    }
    const result = await createExecutor(adapters)({
      entry,
      actor: { id: 1, team: 1 }
    })
    assert.equal(result.success, false)
    assert.equal(result.outcome, 'rolledBack')
    assert.deepEqual(inspect(filename).columns, ['id', 'title'])
    assert.equal(releases(), 1)
  }))

async function upgradeFixture(run) {
  return fixture(async (state) => {
    const { service, filename, entry } = state
    const fromSchemaHash = ledger.schemaHash(service)
    const preview = new Database(filename)
    preview.exec('BEGIN IMMEDIATE')
    for (const statement of entry.selected) preview.exec(statement.sql)
    const toSchemaHash = ledger.schemaHash({
      ...service,
      transaction: { database: preview }
    })
    preview.exec('ROLLBACK')
    preview.close()
    const identity = ledger.createManifest({
      format: 1,
      version: '0.0.88',
      image: `ghcr.io/sailscastshq/slipway@sha256:${'a'.repeat(64)}`,
      steps: [
        {
          id: 'notes-add-note',
          datastore: service.datastore,
          fromSchemaHash,
          toSchemaHash,
          operationsHash: ledger.digest(entry.selected.map(plans.contract))
        }
      ]
    })
    const options = {
      identity,
      stepId: 'notes-add-note',
      databaseKey: entry.payload.target.physicalKey,
      fenceId: 'stopped-container-fixture',
      backupId: 'verified-fixture-backup'
    }
    state.adapters.beforeCommit = ledger.receiptWriter(options)
    await run({ ...state, identity, options })
  })
}
function receipts(filename, identity, options) {
  const db = new Database(filename, { readonly: true })
  try {
    return ledger.readLedger(db, identity, 'observability', options.databaseKey)
  } finally {
    db.close()
  }
}
test('upgrade receipt and schema commit together on a non-default datastore', () =>
  upgradeFixture(async ({ adapters, entry, filename, identity, options }) => {
    const result = await createExecutor(adapters)({
      entry,
      actor: { id: 1, team: 1 }
    })
    assert.equal(result.success, true, JSON.stringify(result))
    assert.ok(inspect(filename).columns.includes('note'))
    assert.equal(
      receipts(filename, identity, options)[0].stepId,
      options.stepId
    )
    assert.throws(
      () =>
        receipts(filename, identity, {
          ...options,
          databaseKey: 'another-database'
        }),
      /reviewed upgrade/
    )
  }))
test('receipt failure after insert rolls back both schema and ledger creation', () =>
  upgradeFixture(async ({ adapters, entry, filename, identity, options }) => {
    const write = adapters.beforeCommit
    adapters.beforeCommit = (input) => {
      write(input)
      throw new Error('crash before commit')
    }
    const result = await createExecutor(adapters)({
      entry,
      actor: { id: 1, team: 1 }
    })
    assert.equal(result.outcome, 'rolledBack')
    assert.deepEqual(inspect(filename).columns, ['id', 'title'])
    assert.deepEqual(receipts(filename, identity, options), [])
  }))
test('post-commit audit failure retains the durable receipt for reconciliation', () =>
  upgradeFixture(async ({ adapters, entry, filename, identity, options }) => {
    adapters.audit = async (_, event) => {
      if (event === 'migration.applied') throw new Error('process interrupted')
    }
    const result = await createExecutor(adapters)({
      entry,
      actor: { id: 1, team: 1 }
    })
    assert.equal(result.outcome, 'committedAuditIncomplete')
    assert.equal(receipts(filename, identity, options).length, 1)
    assert.ok(inspect(filename).columns.includes('note'))
  }))
test('an immutable manifest mismatch prevents DDL and receipt from committing', () =>
  upgradeFixture(async ({ adapters, entry, filename, identity, options }) => {
    const changed = JSON.parse(JSON.stringify(identity.manifest))
    changed.steps[0].operationsHash = 'b'.repeat(64)
    adapters.beforeCommit = ledger.receiptWriter({
      ...options,
      identity: ledger.createManifest(changed)
    })
    const result = await createExecutor(adapters)({
      entry,
      actor: { id: 1, team: 1 }
    })
    assert.equal(result.code, 'upgradeLedgerMismatch')
    assert.equal(result.outcome, 'rolledBack')
    assert.deepEqual(inspect(filename).columns, ['id', 'title'])
    assert.deepEqual(receipts(filename, identity, options), [])
  }))
test('reserved ledger collisions fail closed without changing existing objects', () =>
  upgradeFixture(async ({ adapters, entry, filename }) => {
    const db = new Database(filename)
    db.exec(
      `CREATE TABLE ${ledger.table} (unrelated TEXT); INSERT INTO ${ledger.table} VALUES ('preserved')`
    )
    db.close()
    // Refresh the review after introducing a ledger-name collision. Only the
    // ledger contract, rather than general stale-plan detection, rejects it.
    const schema = (
      await adapters.getSchema({ type: 'sqlite', path: filename })
    ).tables
    entry.payload.schemaHash = plans.digest(schema)
    const result = await createExecutor(adapters)({
      entry,
      actor: { id: 1, team: 1 }
    })
    assert.equal(result.code, 'upgradeLedgerMismatch')
    assert.equal(result.outcome, 'rolledBack')
    const check = new Database(filename, { readonly: true })
    assert.equal(
      check.prepare(`SELECT unrelated FROM ${ledger.table}`).get().unrelated,
      'preserved'
    )
    check.close()
    assert.deepEqual(inspect(filename).columns, ['id', 'title'])
  }))
