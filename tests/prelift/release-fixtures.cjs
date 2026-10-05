const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const Database = require('better-sqlite3')
const registry = require('../../api/lib/upgrade-registry')
const ledger = require('../../api/lib/upgrade-ledger')
const readSchema = require('../../api/lib/sqlite-schema')
const preflight = require('../../api/lib/upgrade-preflight')
const coordinator = require('../../api/lib/upgrade-coordinator')
const { createBackupSet } = require('../../api/lib/upgrade-backups')
const fresh = require('../../api/lib/upgrades/baselines/0.0.87.json')
const old = require('../../api/lib/upgrades/baselines/0.0.86.json')
const legacy = require('../../api/lib/upgrades/baselines/legacy-86-to-87.json')
const manual = require('../../api/lib/upgrades/baselines/bosun-86-to-87.json')
const getDiff = require('../../api/helpers/dock/generate-diff').fn
const getSql = require('../../api/helpers/dock/generate-migration-sql').fn
const image = `ghcr.io/sailscastshq/slipway@sha256:${'a'.repeat(64)}`
function replay(db, schema) {
  for (const table of Object.values(schema)) db.exec(table.sql)
  for (const table of Object.values(schema)) {
    for (const index of [...table.indexes].reverse())
      if (index.sql) db.exec(index.sql)
    for (const trigger of table.triggers) db.exec(trigger.sql)
  }
}
function seed(db, table, overrides) {
  const columns = db.pragma(`table_info('${table}')`)
  if (!columns.length) return
  const values = { id: 1, ...overrides }
  for (const column of columns)
    if (
      column.notnull &&
      column.dflt_value === null &&
      !Object.hasOwn(values, column.name)
    )
      values[column.name] = /INT|REAL|FLOAT|NUMERIC|BOOLEAN/i.test(column.type)
        ? 1
        : 'fixture-value'
  const names = Object.keys(values).filter((name) =>
    columns.some((column) => column.name === name)
  )
  db.prepare(
    `INSERT INTO "${table}" (${names
      .map((name) => `"${name}"`)
      .join(',')}) VALUES (${names.map(() => '?').join(',')})`
  ).run(...names.map((name) => values[name]))
}
function protectedRows(service) {
  const db = new Database(service.path, { readonly: true })
  try {
    const result = {}
    for (const name of [
      'apps',
      'helm_history_entries',
      'quest_runs',
      'resource_alert_deliveries',
      'restore_tests'
    ])
      if (
        db
          .prepare(
            "SELECT name FROM sqlite_schema WHERE type = 'table' AND name = ?"
          )
          .get(name)
      )
        result[name] = db.prepare(`SELECT * FROM "${name}"`).all()
    return result
  } finally {
    db.close()
  }
}
async function fixture(profile, run, partial = false) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'upgrade-registry-'))
  const services = []
  try {
    for (const datastore of [
      'default',
      'observability',
      'analytics',
      'cache'
    ]) {
      const filename = path.join(directory, datastore + '.db')
      const db = new Database(filename)
      let schema =
        profile === null
          ? {}
          : profile === manual
          ? {
              ...old.databases[datastore].schema,
              ...(manual.databases[datastore]?.schema || {})
            }
          : profile.databases[datastore].schema
      if (partial && datastore === 'observability') {
        schema = { ...schema }
        delete schema.resource_alert_deliveries
      }
      replay(db, schema)
      seed(db, 'apps', { name: 'protected-app', slug: 'protected-app' })
      seed(db, 'helm_history_entries', {
        source: 'protected Helm history',
        mode: 'javascript'
      })
      seed(db, 'quest_runs', {
        run_id: 'receipt-to-preserve',
        request_key: 'request-to-preserve',
        input_hash: 'input-to-preserve',
        environment: '1',
        app: '1',
        job_name: 'fixture-job',
        requested_at: 1,
        state: 'succeeded',
        result: '{"protected":true}'
      })
      seed(db, 'resource_alert_deliveries', {
        incident_key: 'incident-to-preserve',
        container_name: 'fixture-container',
        resource: 'cpu',
        observed_at: 1,
        payload: '{"protected":true}',
        lease_owner: 'lease-to-preserve',
        lease_until: 9999999999999
      })
      seed(db, 'restore_tests', {
        backup: 1,
        service: 1,
        team: 1,
        resource_name: 'restore-fixture',
        report: '{"protected":true}'
      })
      db.close()
      services.push({
        datastore,
        path: filename,
        databaseKey: `fixture-instance:${datastore}`
      })
    }
    await run({ directory, services })
  } finally {
    fs.rmSync(directory, { recursive: true, force: true })
  }
}
async function complete({ directory, services }, mode) {
  const identity = registry.createReleasePlan({
    services,
    image,
    instanceId: 'fixture-instance',
    mode
  })
  const before = services.map(protectedRows)
  const fenceId = 'fixture-all-writers-stopped'
  const backupSet = await createBackupSet({
    databases: services,
    directory,
    maxBytes: 50 * 1024 * 1024,
    reserveBytes: 0,
    timeoutMs: 30000,
    verifyFence: async () => ({
      id: fenceId,
      writersStopped: true,
      databaseKeys: services.map((item) => item.databaseKey)
    })
  })
  const preview = await preflight({
    identity,
    backupSet,
    preparePlan: registry.preparePlan,
    timeoutMs: 30000
  })
  const handle = await coordinator.prepareRun({
    directory,
    identity,
    databases: services,
    backupSet,
    preflight: preview,
    timeoutMs: 30000,
    instanceId: 'fixture-instance'
  })
  const result = await coordinator.run({
    filename: handle.filename,
    owner: 'fixture-controller',
    expectedInstanceId: 'fixture-instance',
    expectedManifestHash: identity.hash,
    timeoutMs: 30000,
    preparePlan: registry.preparePlan,
    verifyFence: async (targets, { owner }) => ({
      id: fenceId,
      writersStopped: true,
      exclusiveController: true,
      controllerOwner: owner,
      databaseKeys: targets.map((item) => item.databaseKey)
    })
  })
  assert.equal(result.phase, 'completed')
  for (const [index, service] of services.entries()) {
    const after = protectedRows(service)
    for (const [table, rows] of Object.entries(before[index])) {
      if (table === 'helm_history_entries') {
        for (const row of rows)
          for (const [key, value] of Object.entries(row))
            assert.equal(
              after[table].find((item) => item.id === row.id)[key],
              value
            )
      } else assert.deepEqual(after[table], rows)
    }
    assert.equal(
      ledger.inspectState(service, identity, service.databaseKey).complete,
      true
    )
    if (mode === 'fresh')
      assert.equal(
        ledger.schemaHash(service),
        fresh.databases[service.datastore].schemaHash
      )
    else if (['analytics', 'cache'].includes(service.datastore)) {
      assert.equal(
        identity.manifest.steps.find(
          (step) => step.datastore === service.datastore
        ).operationIds.length,
        0
      )
      assert.equal(
        ledger.schemaHash(service),
        old.databases[service.datastore].schemaHash
      )
    }
  }
  return identity
}

module.exports = {
  fixture,
  complete,
  seed,
  replay,
  protectedRows,
  image,
  profiles: { old, fresh, legacy, manual }
}
