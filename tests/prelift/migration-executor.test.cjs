// Run with node --test. No Sails app, hooks, globals, ORM, or credentials.
const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const Database = require('better-sqlite3')
const createExecutor = require('../../api/lib/migration-executor')
const plans = require('../../api/lib/migration-plans')
const getSchema = require('../../api/helpers/dock/get-schema').fn
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
  const service = { type: 'sqlite', path: filename, datastore: 'fixture' }
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
    await run({ adapters, entry, filename, events, releases: () => releases })
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
