const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const Database = require('better-sqlite3')
const ledger = require('../../api/lib/upgrade-ledger')
const inventory = require('../../api/lib/upgrades/schema-helper-inventory.json')
const { fixture, complete, profiles } = require('./release-fixtures.cjs')

test('retirement inventory covers every bootstrap schema helper and the Lookout hook, with mixed business work preserved', () => {
  const bootstrap = fs.readFileSync(
    path.resolve(__dirname, '../../config/bootstrap.js'),
    'utf8'
  )
  const called = [
    ...bootstrap.matchAll(/sails\.helpers\.([a-z]+)\.(ensure\w*Schema)\(/g)
  ].map((match) => `${match[1]}.${match[2]}`)
  assert.equal(called.length, 17)
  assert.equal(inventory.helpers.length, 18)
  assert.deepEqual(
    inventory.helpers.map((entry) => entry.helper).sort(),
    [...called, 'lookout.ensureObservabilitySchema'].sort()
  )
  for (const name of [
    'team.ensureSchema',
    'configuration.ensureSchema',
    'wake.ensureSchema',
    'lookout.ensureObservabilitySchema'
  ])
    assert.ok(
      inventory.helpers.find((entry) => entry.helper === name).responsibilities
        .length > 1
    )
  assert.ok(
    inventory.preserveBusinessRecovery.includes('service.migrateLegacyVersions')
  )
})
for (const [name, profile] of [
  ['fresh', null],
  ['86', profiles.old],
  ['manual', profiles.manual]
])
  test(`all 18 existing ensure helpers need no further DDL after registered ${name} completion`, () =>
    fixture(profile, async (state) => {
      await complete(state, profile === null ? 'fresh' : 'upgrade')
      const before = state.services.map((service) => ledger.schemaHash(service))
      const databases = new Map(
        state.services.map((service) => [
          service.datastore,
          new Database(service.path)
        ])
      )
      const queries = []
      const priorSails = global.sails,
        priorApp = global.App,
        priorSetting = global.Setting,
        priorService = global.Service
      try {
        // This proof executes real old DDL against real native catalogs. It
        // deliberately skips already-completed model data backfills; those are
        // inventoried obligations, not permission to delete mixed helpers.
        global.App = { find: () => ({ decrypt: async () => [] }) }
        global.Service = { update: () => ({ set: async () => [] }) }
        global.Setting = {
          findOne: async () => ({ key: 'teamMembershipMigration', value: '1' })
        }
        global.sails = {
          getDatastore: (name = 'default') => ({
            manager: databases.get(name),
            sendNativeQuery: async (sql, params = []) => {
              const statement = databases.get(name).prepare(sql)
              queries.push({
                datastore: name,
                kind: sql.trim().split(/\s+/)[0].toUpperCase()
              })
              return {
                rows: statement.reader
                  ? statement.all(...params)
                  : (statement.run(...params), [])
              }
            }
          }),
          config: { environment: 'test' },
          wakeStorageFallback: false
        }
        for (const entry of inventory.helpers)
          await require(path.resolve(__dirname, '../..', entry.source)).fn()
        assert.equal(global.sails.wakeStorageReady, true)
        assert.ok(queries.some((query) => query.kind === 'CREATE'))
        assert.ok(queries.some((query) => query.kind === 'UPDATE'))
        state.services.forEach((service, index) =>
          assert.equal(
            ledger.schemaHash(service),
            before[index],
            service.datastore
          )
        )
      } finally {
        for (const db of databases.values()) db.close()
        if (priorSails === undefined) delete global.sails
        else global.sails = priorSails
        if (priorApp === undefined) delete global.App
        else global.App = priorApp
        if (priorSetting === undefined) delete global.Setting
        else global.Setting = priorSetting
        if (priorService === undefined) delete global.Service
        else global.Service = priorService
      }
    }))
