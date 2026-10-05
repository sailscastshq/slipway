const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const Database = require('better-sqlite3')
const runPreflight = require('../../api/lib/upgrade-preflight')
const {
  createBackupSet,
  verifyBackupSet
} = require('../../api/lib/upgrade-backups')
const ledger = require('../../api/lib/upgrade-ledger')
const plans = require('../../api/lib/migration-plans')
const readSchema = require('../../api/lib/sqlite-schema')
const generateDiff = require('../../api/helpers/dock/generate-diff').fn
const generateSql = require('../../api/helpers/dock/generate-migration-sql').fn
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
async function preparePlan({ step, service, source }) {
  const schema = readSchema(service).tables
  const diff = await generateDiff({ models, schema, dbType: 'sqlite' })
  const statements = (
    await generateSql({ diff, dbType: 'sqlite', models, schema })
  ).statements
  const selected = statements.map((statement, index) => ({
    ...statement,
    operationId: `step-${index}`
  }))
  return {
    models,
    entry: {
      id: step.id,
      hash: 'fixture-reviewed',
      payload: {
        target: {
          kind: 'bosun',
          key: step.datastore,
          physicalKey: `fixture:${step.datastore}`
        },
        sourceHash: plans.digest(source),
        modelHash: plans.digest(models),
        schemaHash: plans.digest(schema),
        statements
      },
      selected,
      tables: new Set(selected.map((item) => item.table)),
      release: () => {}
    }
  }
}
async function fixture(run) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'upgrade-preflight-'))
  const databases = []
  const steps = []
  try {
    for (const datastore of ['default', 'observability']) {
      const filename = path.join(directory, `${datastore}.db`)
      const db = new Database(filename)
      db.exec(
        "CREATE TABLE notes (id INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL, title TEXT); INSERT INTO notes(title) VALUES ('protected')"
      )
      const service = { path: filename, type: 'sqlite', datastore }
      const fromSchemaHash = ledger.schemaHash(service)
      const { entry } = await preparePlan({
        step: { id: datastore, datastore },
        service,
        source: {}
      })
      db.exec('BEGIN IMMEDIATE')
      for (const statement of entry.selected) db.exec(statement.sql)
      const toSchemaHash = ledger.schemaHash({
        ...service,
        transaction: { database: db }
      })
      db.exec('ROLLBACK')
      db.close()
      databases.push({
        datastore,
        path: filename,
        databaseKey: `fixture:${datastore}`
      })
      steps.push({
        id: datastore,
        datastore,
        fromSchemaHash,
        toSchemaHash,
        operationsHash: ledger.digest(entry.selected.map(plans.contract))
      })
    }
    const identity = ledger.createManifest({
      format: 1,
      version: '0.0.88',
      image: `ghcr.io/sailscastshq/slipway@sha256:${'a'.repeat(64)}`,
      steps
    })
    const backupSet = await createBackupSet({
      databases,
      directory,
      maxBytes: 10 * 1024 * 1024,
      reserveBytes: 0,
      timeoutMs: 10000,
      verifyFence: async () => ({
        id: 'fixture-writers-stopped',
        writersStopped: true,
        databaseKeys: databases.map((item) => item.databaseKey)
      })
    })
    await run({ identity, backupSet, databases, directory })
  } finally {
    fs.rmSync(directory, { recursive: true, force: true })
  }
}
test('clone preflight uses the shared executor and leaves live databases and recovery snapshots unchanged', () =>
  fixture(async ({ identity, backupSet, databases }) => {
    const originals = databases.map((item) => fs.readFileSync(item.path))
    const before = await verifyBackupSet(backupSet, 10000)
    const result = await runPreflight({
      backupSet,
      identity,
      preparePlan: async (input) => {
        assert.equal(global.sails, undefined)
        assert.ok(
          input.service.path.startsWith(
            backupSet.directory + path.sep + 'preflight-'
          )
        )
        return preparePlan(input)
      },
      timeoutMs: 10000
    })
    assert.equal(result.dryRun, true)
    assert.deepEqual(result.steps, [
      { stepId: 'default', outcome: 'verifiedOnClone' },
      { stepId: 'observability', outcome: 'verifiedOnClone' }
    ])
    assert.deepEqual(await verifyBackupSet(backupSet, 10000), before)
    assert.equal(
      fs
        .readdirSync(backupSet.directory)
        .some((item) => item.startsWith('preflight-')),
      false
    )
    databases.forEach((item, index) =>
      assert.deepEqual(fs.readFileSync(item.path), originals[index])
    )
  }))
test('a later database manifest mismatch fails preflight without live receipts or DDL', () =>
  fixture(async ({ identity, backupSet, databases }) => {
    const modified = JSON.parse(JSON.stringify(identity.manifest))
    modified.steps[1].toSchemaHash = 'f'.repeat(64)
    const originals = databases.map((item) => fs.readFileSync(item.path))
    await assert.rejects(
      () =>
        runPreflight({
          backupSet,
          identity: ledger.createManifest(modified),
          preparePlan,
          timeoutMs: 10000
        }),
      /immutable manifest/
    )
    databases.forEach((item, index) =>
      assert.deepEqual(fs.readFileSync(item.path), originals[index])
    )
    assert.equal(
      fs
        .readdirSync(backupSet.directory)
        .some((item) => item.startsWith('preflight-')),
      false
    )
    await verifyBackupSet(backupSet, 10000)
  }))
test('a plan for a different pinned source cannot execute even on the clone', () =>
  fixture(async ({ identity, backupSet }) => {
    await assert.rejects(
      () =>
        runPreflight({
          backupSet,
          identity,
          preparePlan: async (input) => {
            const result = await preparePlan(input)
            result.entry.payload.sourceHash = 'another-source'
            return result
          },
          timeoutMs: 10000
        }),
      /pinned source and target/
    )
    await verifyBackupSet(backupSet, 10000)
  }))

test('a stalled plan registry hits the deadline and removes its disposable clones', () =>
  fixture(async ({ identity, backupSet }) => {
    await assert.rejects(
      () =>
        runPreflight({
          backupSet,
          identity,
          preparePlan: () => new Promise(() => {}),
          timeoutMs: 100
        }),
      /deadline/
    )
    assert.equal(
      fs
        .readdirSync(backupSet.directory)
        .some((item) => item.startsWith('preflight-')),
      false
    )
    await verifyBackupSet(backupSet, 10000)
  }))
