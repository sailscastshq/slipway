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
test('additive observability migration is repeatable and preserves legacy incidents and telemetry', async () => {
  const { DatabaseSync } = require('node:sqlite')
  const helperPath = path.resolve(
    'api/helpers/lookout/ensure-observability-schema.js'
  )
  const helper = require(helperPath)
  const db = new DatabaseSync(':memory:')
  const original = global.sails
  const before = []
  try {
    db.exec(
      'CREATE TABLE resource_alert_states (id INTEGER PRIMARY KEY, container_name TEXT, memory_active INTEGER, last_sample_at INTEGER)'
    )
    db.prepare('INSERT INTO resource_alert_states VALUES (1, ?, 1, 123)').run(
      'legacy'
    )
    global.sails = {
      getDatastore: () => ({
        sendNativeQuery: async (sql, values = []) => {
          before.push(sql)
          const stmt = db.prepare(sql)
          return { rows: stmt.all(...values) }
        }
      })
    }
    await helper.fn()
    await helper.fn()
    assert.deepEqual(
      { ...db.prepare('SELECT * FROM resource_alert_states').get() },
      {
        id: 1,
        container_name: 'legacy',
        memory_active: 1,
        last_sample_at: 123
      }
    )
    assert.equal(
      db
        .prepare(
          "SELECT count(*) n FROM sqlite_master WHERE name='resource_alert_deliveries'"
        )
        .get().n,
      1
    )
    assert.ok(before.every((sql) => !/DROP TABLE|ALTER TABLE/i.test(sql)))
    const plan = db
      .prepare(
        "EXPLAIN QUERY PLAN SELECT id FROM resource_alert_deliveries WHERE status='pending' AND next_attempt_at<=1 AND lease_until<=1 LIMIT 5"
      )
      .all()
    assert.ok(
      plan.some((row) => row.detail.includes('resource_alert_deliveries_due'))
    )
  } finally {
    global.sails = original
    db.close()
  }
})
