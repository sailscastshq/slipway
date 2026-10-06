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
      // Explicit legacy-release compatibility proof; current 88 requires admission.
      const pkg = require('../../package.json'),
        priorVersion = pkg.version
      const priorSails = global.sails,
        priorApp = global.App,
        priorSetting = global.Setting,
        priorService = global.Service
      try {
        pkg.version = '0.0.87'
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
        pkg.version = priorVersion
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

for (const [name, profile] of [
  ['fresh', null],
  ['86', profiles.old],
  ['manual', profiles.manual]
]) {
  test(`all coordinated ${name} helpers retain business work and issue zero DDL after native admission`, () =>
    fixture(profile, async (state) => {
      const identity = await complete(
        state,
        profile === null ? 'fresh' : 'upgrade'
      )
      const run = fs
        .readdirSync(state.directory)
        .find((name) => name.startsWith('run-'))
      const filename = path.join(state.directory, run, 'run.json')
      const markerFile = path.join(state.directory, 'launch.json')
      require('../../api/lib/upgrade-startup').writeMarker(markerFile, {
        format: 1,
        phase: 'publishing',
        filename,
        instanceId: identity.manifest.instanceId,
        version: identity.manifest.version,
        image: identity.manifest.image,
        manifestHash: identity.hash
      })
      const environment = {
        SLIPWAY_UPGRADE_MARKER: markerFile,
        SLIPWAY_UPGRADE_INSTANCE: identity.manifest.instanceId,
        SLIPWAY_UPGRADE_IMAGE: identity.manifest.image,
        SLIPWAY_UPGRADE_MANIFEST: identity.hash
      }
      const priorEnvironment = Object.fromEntries(
        Object.keys(environment).map((key) => [key, process.env[key]])
      )
      const priorGlobals = Object.fromEntries(
        ['sails', 'App', 'Setting', 'Service'].map((key) => [key, global[key]])
      )
      const pkg = require('../../package.json'),
        priorVersion = pkg.version
      const databases = new Map(
        state.services.map((service) => [
          service.datastore,
          new Database(service.path)
        ])
      )
      const queries = [],
        before = state.services.map((service) => ledger.schemaHash(service))
      try {
        // Model the compiled release's package metadata while retaining the real
        // native manifest, receipts, inode checks and datastore catalogs.
        pkg.version = identity.manifest.version
        Object.assign(process.env, environment)
        global.App = { find: () => ({ decrypt: async () => [] }) }
        global.Setting = {
          findOne: async () => ({ key: 'teamMembershipMigration', value: '1' })
        }
        global.Service = { update: () => ({ set: async () => [] }) }
        global.sails = {
          getDatastore: (name = 'default') => ({
            manager: databases.get(name),
            sendNativeQuery: async (sql, params = []) => {
              queries.push(sql)
              assert.doesNotMatch(sql, /\b(?:CREATE|ALTER|DROP)\b/i)
              const statement = databases.get(name).prepare(sql)
              return {
                rows: statement.reader
                  ? statement.all(...params)
                  : (statement.run(...params), [])
              }
            }
          }),
          config: {
            environment: 'test',
            datastores: Object.fromEntries(
              state.services.map((service) => [
                service.datastore,
                { adapter: 'sails-sqlite', url: service.path }
              ])
            )
          },
          log: { warn() {} },
          wakeStorageFallback: false,
          upgradeAdmission: { verified: true }
        }
        for (const entry of inventory.helpers)
          await require(path.resolve(__dirname, '../..', entry.source)).fn()
        assert.equal(sails.wakeStorageReady, true)
        assert.ok(queries.some((sql) => /^\s*UPDATE\b/i.test(sql)))
        state.services.forEach((service, index) =>
          assert.equal(
            ledger.schemaHash(service),
            before[index],
            service.datastore
          )
        )
        const count = queries.length
        process.env.SLIPWAY_UPGRADE_MANIFEST = 'f'.repeat(64)
        await assert.rejects(
          require('../../api/helpers/auth/ensure-schema').fn(),
          { code: 'upgradeNotReady' }
        )
        assert.equal(
          queries.length,
          count,
          'a forged admission flag cannot authorize DDL or business work'
        )
      } finally {
        pkg.version = priorVersion
        for (const db of databases.values()) db.close()
        for (const [key, value] of Object.entries(priorEnvironment))
          if (value === undefined) delete process.env[key]
          else process.env[key] = value
        for (const [key, value] of Object.entries(priorGlobals))
          if (value === undefined) delete global[key]
          else global[key] = value
      }
    }))
}
