const { test } = require('sounding')
const assert = require('node:assert/strict')
const vm = require('node:vm')
const fs = require('node:fs')
const path = require('node:path')
const { createRequire } = require('node:module')
const statsPath = path.resolve('api/helpers/docker/get-container-stats.js')
const realRequire = createRequire(statsPath)
function statsFixture(output, error) {
  const options = []
  const execFile = () => {}
  execFile[require('node:util').promisify.custom] = async (
    binary,
    args,
    opts
  ) => {
    options.push({ binary, args, opts })
    if (error) throw error
    return { stdout: output, stderr: '' }
  }
  const context = {
    module: { exports: {} },
    sails: { config: {}, log: { warn() {}, verbose() {} } },
    require: (name) =>
      name === 'child_process' ? { execFile } : realRequire(name)
  }
  vm.runInNewContext(fs.readFileSync(statsPath, 'utf8'), context)
  return { fn: context.module.exports.fn, options }
}
test('Docker samples require complete finite readings and command execution has a deadline', async () => {
  const good = {
    Name: 'slipway-fixture',
    CPUPerc: '101.14%',
    MemPerc: '90.6%',
    MemUsage: '464MiB / 512MiB'
  }
  const rows = [
    good,
    { ...good, CPUPerc: '' },
    { ...good, CPUPerc: 'Infinity%' },
    { ...good, MemPerc: '-1%' },
    { ...good, MemPerc: '101%' },
    { ...good, MemUsage: '464MiB / 0B' },
    { ...good, MemUsage: '464unknown / 512MiB' },
    { ...good, MemUsage: '464..1MiB / 512MiB' },
    { ...good, CPUPerc: '12garbage%' }
  ]
  const f = statsFixture(rows.map((x) => JSON.stringify(x)).join('\n'))
  const result = await f.fn()
  assert.equal(result.length, 1)
  assert.equal(result[0].cpuPercent, 101.14)
  assert.equal(result[0].memLimit, 512 * 1048576)
  assert.equal(f.options[0].opts.timeout, 10000)
  assert.equal(f.options[0].opts.killSignal, 'SIGKILL')
  assert.equal(f.options[0].opts.maxBuffer, 1048576)
  const failed = statsFixture(
    '',
    Object.assign(new Error('stats deadline'), { killed: true })
  )
  await assert.rejects(failed.fn(), /stats deadline/)
})
test('native observability migration preserves legacy incidents and telemetry before repeatable admitted startup', async () => {
  const Database = require('better-sqlite3')
  const {
    fixture,
    complete,
    seed,
    profiles
  } = require('../../../prelift/release-fixtures.cjs')
  const startup = require('../../../../api/lib/upgrade-startup')
  const ledger = require('../../../../api/lib/upgrade-ledger')
  const helper = require('../../../../api/helpers/lookout/ensure-observability-schema')
  await fixture(profiles.old, async (state) => {
    const service = state.services.find(
      (item) => item.datastore === 'observability'
    )
    const source = new Database(service.path)
    let incidents, telemetry
    try {
      seed(source, 'resource_alert_states', {
        container_name: 'legacy',
        memory_active: '1',
        last_sample_at: 123
      })
      seed(source, 'telemetry_spans', {
        created_at: 123,
        trace_id: 'legacy-trace',
        span_id: 'legacy-span',
        name: 'legacy-request',
        started_at: 123,
        attributes: '{"retained":true}'
      })
      incidents = source
        .prepare(
          'SELECT id, container_name, memory_active, last_sample_at FROM resource_alert_states'
        )
        .all()
      telemetry = source.prepare('SELECT * FROM telemetry_spans').all()
    } finally {
      source.close()
    }
    // Registered 86 catalogs, real mandatory backups, clone preflight and the
    // existing transaction/receipt engine establish all four stores before any
    // current-release helper is admitted. No package-version or guard override.
    const identity = await complete(state)
    const run = fs
      .readdirSync(state.directory)
      .find((name) => name.startsWith('run-'))
    const markerFile = path.join(state.directory, 'launch.json')
    startup.writeMarker(markerFile, {
      format: 1,
      phase: 'ready',
      filename: path.join(state.directory, run, 'run.json'),
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
    const previousEnvironment = Object.fromEntries(
      Object.keys(environment).map((name) => [name, process.env[name]])
    )
    const original = global.sails
    const databases = new Map(
      state.services.map((item) => [item.datastore, new Database(item.path)])
    )
    const before = state.services.map((item) => ledger.schemaHash(item))
    const queries = []
    try {
      Object.assign(process.env, environment)
      global.sails = {
        config: {
          models: { migrate: 'safe' },
          datastores: Object.fromEntries(
            state.services.map((item) => [
              item.datastore,
              { adapter: 'sails-sqlite', url: item.path }
            ])
          )
        },
        getDatastore: (name = 'default') => ({
          manager: databases.get(name),
          sendNativeQuery: async (sql, values = []) => {
            queries.push(sql)
            const stmt = databases.get(name).prepare(sql)
            return {
              rows: stmt.reader
                ? stmt.all(...values)
                : (stmt.run(...values), [])
            }
          }
        })
      }
      require('../../../../api/hooks/upgrade-admission')(
        global.sails
      ).configure()
      assert.equal(global.sails.upgradeAdmission.verified, true)
      await helper.fn()
      await helper.fn()
      const db = databases.get('observability')
      assert.deepEqual(
        db
          .prepare(
            'SELECT id, container_name, memory_active, last_sample_at FROM resource_alert_states'
          )
          .all(),
        incidents
      )
      assert.deepEqual(
        db.prepare('SELECT * FROM telemetry_spans').all(),
        telemetry
      )
      assert.equal(
        db
          .prepare(
            "SELECT count(*) n FROM sqlite_schema WHERE name='resource_alert_deliveries'"
          )
          .get().n,
        1
      )
      assert.ok(
        queries.length > 0,
        'Retained startup business work must execute'
      )
      assert.ok(
        queries.every((sql) => !/\b(?:CREATE|ALTER|DROP)\b/i.test(sql)),
        'Admitted startup must issue zero DDL'
      )
      state.services.forEach((item, index) =>
        assert.equal(ledger.schemaHash(item), before[index])
      )
      const plan = db
        .prepare(
          "EXPLAIN QUERY PLAN SELECT id FROM resource_alert_deliveries WHERE status='pending' AND next_attempt_at<=1 AND lease_until<=1 LIMIT 5"
        )
        .all()
      assert.ok(
        plan.some((row) => row.detail.includes('resource_alert_deliveries_due'))
      )
      assert.equal(
        startup.fromEnvironment(global.sails.config.datastores).verified,
        true
      )
    } finally {
      global.sails = original
      for (const db of databases.values()) db.close()
      for (const [name, value] of Object.entries(previousEnvironment)) {
        if (value === undefined) delete process.env[name]
        else process.env[name] = value
      }
    }
  })
})
