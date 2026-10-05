const assert = require('node:assert/strict')
const { test } = require('node:test')
const Database = require('better-sqlite3')
const prune = require('../../../../api/helpers/lookout/prune-observability')

test('Quest retention and protected alert delivery coexist after the main merge', async () => {
  const db = new Database(':memory:')
  const previous = global.sails
  const now = Date.UTC(2026, 9, 4)
  const day = 86400000
  db.exec(`
    CREATE TABLE quest_runs (id TEXT PRIMARY KEY, requested_at INTEGER);
    CREATE TABLE resource_alert_deliveries (
      id TEXT PRIMARY KEY, container_name TEXT, resource TEXT,
      status TEXT, observed_at INTEGER
    );
    CREATE TABLE resource_alert_states (
      id TEXT PRIMARY KEY, container_name TEXT, cpu_active INTEGER,
      memory_active INTEGER, last_sample_at INTEGER
    );
    CREATE TABLE container_metrics (id TEXT PRIMARY KEY, recorded_at INTEGER);
    CREATE TABLE telemetry_spans (id TEXT PRIMARY KEY, created_at INTEGER);
    CREATE TABLE telemetry_exceptions (id TEXT PRIMARY KEY, created_at INTEGER);
    CREATE TABLE telemetry_metrics (id TEXT PRIMARY KEY, created_at INTEGER);
  `)
  const insertRun = db.prepare('INSERT INTO quest_runs VALUES (?, ?)')
  insertRun.run('expired-quest', now - 8 * day)
  insertRun.run('quest-at-cutoff', now - 7 * day)
  db.prepare('INSERT INTO resource_alert_states VALUES (?, ?, ?, ?, ?)').run(
    'active',
    'active-container',
    0,
    1,
    now
  )
  const insertDelivery = db.prepare(
    'INSERT INTO resource_alert_deliveries VALUES (?, ?, ?, ?, ?)'
  )
  insertDelivery.run(
    'old-active',
    'active-container',
    'memory',
    'sent',
    now - 42 * day
  )
  insertDelivery.run(
    'latest-active',
    'active-container',
    'memory',
    'sent',
    now - 41 * day
  )
  insertDelivery.run(
    'pending',
    'pending-container',
    'cpu',
    'pending',
    now - 40 * day
  )
  insertDelivery.run(
    'expired-delivered',
    'recovered-container',
    'memory',
    'sent',
    now - 40 * day
  )
  global.sails = {
    getDatastore(name) {
      assert.equal(name, 'observability')
      return {
        async sendNativeQuery(sql, values = []) {
          const statement = db.prepare(sql)
          return statement.reader
            ? { rows: statement.all(...values) }
            : statement.run(...values)
        }
      }
    }
  }
  try {
    const result = await prune.fn({
      now,
      containerRetentionMs: day,
      telemetryRetentionMs: 30 * day,
      batchSize: 1,
      maxBatches: 10
    })
    assert.equal(result.tables.questRuns.cutoff, now - 7 * day)
    assert.equal(result.tables.questRuns.deletedRows, 1)
    assert.deepEqual(db.prepare('SELECT id FROM quest_runs').all(), [
      { id: 'quest-at-cutoff' }
    ])
    assert.equal(result.tables.resourceAlertDeliveries.deletedRows, 2)
    assert.deepEqual(
      db.prepare('SELECT id FROM resource_alert_deliveries ORDER BY id').all(),
      [{ id: 'latest-active' }, { id: 'pending' }]
    )
    assert.equal(result.hasBacklog, false)
  } finally {
    if (previous === undefined) delete global.sails
    else global.sails = previous
    db.close()
  }
})
