const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const Database = require('better-sqlite3')
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

async function coordinatorFixture(run) {
  const coordinator = require('../../api/lib/upgrade-coordinator')
  const preflight = require('../../api/lib/upgrade-preflight')
  return fixture(async (state) => {
    const { directory, identity, databases, backupSet } = state
    const preview = await preflight({
      backupSet,
      identity,
      preparePlan,
      timeoutMs: 10000
    })
    const handle = await coordinator.prepareRun({
      directory,
      identity,
      databases,
      backupSet,
      preflight: preview,
      timeoutMs: 10000,
      instanceId: 'fixture-instance'
    })
    const options = {
      filename: handle.filename,
      owner: 'fixture-controller',
      preparePlan,
      timeoutMs: 10000,
      expectedInstanceId: 'fixture-instance',
      expectedManifestHash: identity.hash,
      verifyFence: async (targets, { owner }) => ({
        id: backupSet.receipt.fenceId,
        writersStopped: true,
        exclusiveController: true,
        controllerOwner: owner,
        databaseKeys: targets.map((target) => target.databaseKey),
        previousOwnerStopped: false
      })
    }
    await run({ ...state, handle, options })
  })
}

module.exports = { fixture, preparePlan, models, coordinatorFixture }
