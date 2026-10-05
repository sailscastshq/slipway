const { test } = require('node:test')
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
const { fixture, complete, seed } = require('./release-fixtures.cjs')

for (const [name, profile] of [
  ['86', old],
  ['87 fresh', fresh],
  ['87 legacy', legacy],
  ['manual Bosun', manual]
])
  test(`registered ${name} upgrades preserve protected app, Helm, Quest, alert-lease and restore-test rows`, () =>
    fixture(profile, (state) => complete(state, 'upgrade')))
test('partial manual adoption completes missing tables and registered indexes without reapplying existing work', () =>
  fixture(
    manual,
    async (state) => {
      const db = new Database(state.services[0].path)
      db.exec('DROP INDEX helm_history_scope')
      db.close()
      await complete(state, 'upgrade')
    },
    true
  ))
test('fresh initialization uses the same executor and exactly reproduces the current four native catalogs', () =>
  fixture(null, (state) => complete(state, 'fresh')))
test('same-named wrong indexes, weakened constraints, missing core tables and unknown views fail before live DDL', () =>
  fixture(fresh, ({ services }) => {
    const service = services[0]
    const db = new Database(service.path)
    db.exec(
      'DROP INDEX helm_history_scope; CREATE INDEX helm_history_scope ON helm_history_entries(executed_at)'
    )
    assert.throws(
      () =>
        registry.createReleasePlan({
          services,
          image,
          instanceId: 'fixture-instance'
        }),
      /unregistered or drifted/
    )
    db.exec('DROP INDEX helm_history_scope')
    db.exec(
      fresh.databases.default.schema.helm_history_entries.indexes.find(
        (index) => index.name === 'helm_history_scope'
      ).sql
    )
    db.exec('CREATE VIEW unexpected AS SELECT id FROM apps')
    assert.throws(
      () =>
        registry.createReleasePlan({
          services,
          image,
          instanceId: 'fixture-instance'
        }),
      /native table definition/
    )
    db.exec('DROP VIEW unexpected; DROP TABLE apps')
    assert.throws(
      () =>
        registry.createReleasePlan({
          services,
          image,
          instanceId: 'fixture-instance'
        }),
      /required legacy table/
    )
    db.close()
  }))
test('fresh mode rejects existing native objects, and already coordinated databases require their recorded resume path', () =>
  fixture(null, async ({ services, directory }) => {
    const db = new Database(services[0].path)
    db.exec('CREATE VIEW unexpected AS SELECT 1 AS value')
    db.close()
    assert.throws(
      () =>
        registry.createReleasePlan({
          services,
          image,
          instanceId: 'fixture-instance',
          mode: 'fresh'
        }),
      /empty native catalog/
    )
    const cleanup = new Database(services[0].path)
    cleanup.exec('DROP VIEW unexpected')
    cleanup.close()
    await complete({ services, directory }, 'fresh')
    assert.throws(
      () =>
        registry.createReleasePlan({
          services,
          image,
          instanceId: 'fixture-instance'
        }),
      /recorded upgrade checkpoint/
    )
  }))
test('the manual profile is produced by the actual shared Bosun diff and SQL generator', async () => {
  for (const [datastore, models] of Object.entries(manual.models)) {
    const schema = old.databases[datastore].schema
    const diff = await getDiff({ models, schema, dbType: 'sqlite' })
    const generated = await getSql({ diff, models, schema, dbType: 'sqlite' })
    assert.deepEqual(generated.statements, manual.operations[datastore])
  }
})

test('duplicate data in a manually created table blocks unique repair on clones before any live mutation', () =>
  fixture(manual, async ({ directory, services }) => {
    const source = services.find(
      (service) => service.datastore === 'observability'
    )
    const db = new Database(source.path)
    seed(db, 'quest_runs', {
      id: 2,
      run_id: 'receipt-to-preserve',
      request_key: 'second-request',
      input_hash: 'second-input',
      environment: '1',
      app: '1',
      job_name: 'fixture-job',
      requested_at: 2
    })
    db.close()
    const originals = services.map((service) => fs.readFileSync(service.path))
    const identity = registry.createReleasePlan({
      services,
      image,
      instanceId: 'fixture-instance'
    })
    const backupSet = await createBackupSet({
      databases: services,
      directory,
      maxBytes: 50 * 1024 * 1024,
      reserveBytes: 0,
      timeoutMs: 30000,
      verifyFence: async () => ({
        id: 'stopped-fixture',
        writersStopped: true,
        databaseKeys: services.map((service) => service.databaseKey)
      })
    })
    await assert.rejects(
      () =>
        preflight({
          identity,
          backupSet,
          preparePlan: registry.preparePlan,
          timeoutMs: 30000
        }),
      /UNIQUE constraint failed/
    )
    services.forEach((service, index) =>
      assert.deepEqual(fs.readFileSync(service.path), originals[index])
    )
  }))

test('a drifted native constraint cannot enter the release plan', () =>
  fixture(legacy, async ({ services }) => {
    const source = services.find(
      (service) => service.datastore === 'observability'
    )
    const db = new Database(source.path)
    db.exec(
      'DROP TABLE quest_runs; CREATE TABLE quest_runs(id INTEGER PRIMARY KEY, run_id TEXT)'
    )
    db.close()
    assert.throws(
      () =>
        registry.createReleasePlan({
          services,
          image,
          instanceId: 'fixture-instance'
        }),
      /native table definition/
    )
  }))

test('registered operations from another datastore are rejected even with a matching recalculated checksum', () =>
  fixture(null, async ({ services }) => {
    const identity = registry.createReleasePlan({
      services,
      image,
      instanceId: 'fixture-instance',
      mode: 'fresh'
    })
    const source = { version: identity.manifest.version, image }
    const cache = identity.manifest.steps.find(
      (step) => step.datastore === 'cache'
    )
    const cachePlan = await registry.preparePlan({
      step: cache,
      service: services.find((service) => service.datastore === 'cache'),
      source
    })
    const step = {
      ...identity.manifest.steps[0],
      operationIds: cache.operationIds,
      operationsHash: ledger.digest(
        cachePlan.entry.selected.map(
          require('../../api/lib/migration-plans').contract
        )
      )
    }
    await assert.rejects(
      () => registry.preparePlan({ step, service: services[0], source }),
      /unregistered operation/
    )
  }))
