const assert = require('node:assert/strict')
const { randomBytes } = require('node:crypto')
const plans = require('../../api/lib/migration-plans')
const context = require('../../api/lib/migration-context')
const apply = require('../../api/helpers/dock/apply-server-plan')
const session = require('../../api/lib/postgres-migration-session')
const schemaHelper = require('../../api/helpers/dock/get-schema')
const diffHelper = require('../../api/helpers/dock/generate-diff')
const sqlHelper = require('../../api/helpers/dock/generate-migration-sql')

// Called only by the disposable native-database fixture runner.
module.exports = async function verify(service) {
  const oldContext = {
    refresh: context.refresh,
    version: context.refreshVersion
  }
  const oldHelpers = {
    schema: sails.helpers.dock.getSchema,
    diff: sails.helpers.dock.generateDiff,
    sql: sails.helpers.dock.generateMigrationSql
  }
  const oldAudit = global.AuditLog,
    oldModelsConfig = sails.config.models
  const events = [],
    actor = { id: 1, team: 1 }
  const target = {
    kind: 'fixture',
    key: service.containerName,
    physicalKey: service.containerName,
    dialect: 'postgresql'
  }
  const source = { fixture: service.containerName }
  const models = {
    probe: {
      tableName: 'migration_probe',
      primaryKey: 'id',
      attributes: {
        id: { type: 'number', autoIncrement: true },
        label: { type: 'string', unique: true },
        note: { type: 'string' }
      }
    }
  }
  const schema = (service) => schemaHelper.fn({ service })
  const diff = (models, schema, dbType) =>
    diffHelper.fn({ models, schema, dbType })
  const sql = (diff, dbType, models, schema) =>
    sqlHelper.fn({ diff, dbType, models, schema })
  Object.assign(sails.helpers.dock, {
    getSchema: schema,
    generateDiff: diff,
    generateMigrationSql: sql
  })
  sails.config.models = {
    dataEncryptionKeys: { default: randomBytes(32).toString('base64') }
  }
  global.AuditLog = {
    create: async (event) => {
      events.push(event)
    }
  }
  context.refresh = async () => ({ service, models, source, target })
  context.refreshVersion = async () => source
  async function query(text) {
    const result = await sails.helpers.dock.executeSql(service, text)
    assert.equal(result.success, true, result.error)
    return result
  }
  async function preview() {
    const before = await schema(service)
    assert.equal(before.error, undefined)
    const changes = await diff(models, before.tables, 'postgresql')
    const generated = await sql(changes, 'postgresql', models, before.tables)
    const plan = await plans.create({
      actor,
      target,
      models,
      source,
      schema: before.tables,
      statements: generated.statements
    })
    assert.ok(plan)
    return plan
  }
  const claim = (plan) =>
    plans.claim({
      id: plan.id,
      hash: plan.hash,
      actor,
      target,
      operationIds: plan.statements.map((item) => item.operationId)
    })
  const has = async (name) =>
    (await schema(service)).tables.migration_probe.columns.some(
      (column) => column.name === name
    )
  try {
    await query(
      "CREATE TABLE migration_probe (id SERIAL PRIMARY KEY, label TEXT); INSERT INTO migration_probe(label) VALUES ('duplicate')"
    )
    const failing = await preview()
    await query("INSERT INTO migration_probe(label) VALUES ('duplicate')")
    const failure = await apply.fn({ entry: claim(failing), actor })
    assert.equal(failure.success, false)
    assert.equal(failure.outcome, 'rolledBack')
    assert.equal(await has('note'), false)
    assert.equal(
      Number(
        (await query('SELECT COUNT(*) AS count FROM migration_probe')).rows[0]
          .count
      ),
      2
    )
    await query('DELETE FROM migration_probe WHERE id = 2')
    const successful = await preview()
    const result = await apply.fn({ entry: claim(successful), actor })
    assert.equal(result.success, true, result.error)
    assert.equal(await has('note'), true)
    assert.ok(events.some((event) => event.action === 'migration.applied'))

    models.probe.attributes.extra = { type: 'string' }
    const stale = await preview()
    await query('ALTER TABLE migration_probe ADD COLUMN outside_change TEXT')
    assert.equal(
      (await apply.fn({ entry: claim(stale), actor })).code,
      'staleMigrationPlan'
    )
    assert.equal(await has('extra'), false)
    const mismatch = await preview()
    sails.helpers.dock.generateDiff = async (...args) => {
      const result = await diff(...args)
      if (
        args[1].migration_probe.columns.some(
          (column) => column.name === 'extra'
        )
      )
        result.state = 'unverified'
      return result
    }
    assert.equal(
      (await apply.fn({ entry: claim(mismatch), actor })).code,
      'migrationPostflightMismatch'
    )
    assert.equal(await has('extra'), false)
    sails.helpers.dock.generateDiff = diff

    const concurrent = await preview()
    const other = session(service)
    try {
      const key = BigInt(
        '0x' + plans.digest(target.physicalKey).slice(0, 15)
      ).toString()
      assert.equal(
        (await other.query(`BEGIN; SELECT pg_advisory_xact_lock(${key})`))
          .success,
        true
      )
      assert.equal(
        (await apply.fn({ entry: claim(concurrent), actor })).code,
        'migrationBusy'
      )
      await other.query('ROLLBACK')
    } finally {
      other.close()
    }
    assert.equal(await has('extra'), false)
    console.log(
      'postgresql: server-plan atomicity, stale schema rejection, advisory locking, and pre-commit postflight verified.'
    )
  } finally {
    context.refresh = oldContext.refresh
    context.refreshVersion = oldContext.version
    Object.assign(sails.helpers.dock, {
      getSchema: oldHelpers.schema,
      generateDiff: oldHelpers.diff,
      generateMigrationSql: oldHelpers.sql
    })
    global.AuditLog = oldAudit
    sails.config.models = oldModelsConfig
  }
}
