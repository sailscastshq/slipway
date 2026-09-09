const {
  DAY,
  RETENTION_DAYS,
  payment,
  readAttribution,
  failure
} = require('../../packages/hook/lib/wake-value-contract')
const visitorHash = (app, id) =>
  require('node:crypto')
    .createHash('sha256')
    .update(app + ':' + id)
    .digest('hex')
function database() {
  if (!sails.wakeStorageReady) throw failure('unavailable')
  const db = sails.getDatastore('analytics').manager
  if (!db?.prepare) throw failure('unavailable')
  return db
}
function schema(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS wake_receipts (app TEXT NOT NULL, receipt_key TEXT NOT NULL, transaction_id TEXT NOT NULL, adjustment_id TEXT, amount INTEGER NOT NULL, currency TEXT NOT NULL, occurred_at INTEGER NOT NULL, received_at INTEGER NOT NULL, visitor_id TEXT, PRIMARY KEY(app, receipt_key));
    CREATE INDEX IF NOT EXISTS wake_receipts_time ON wake_receipts(app, occurred_at, currency);
    CREATE INDEX IF NOT EXISTS wake_receipts_transaction ON wake_receipts(app, transaction_id);
    CREATE TABLE IF NOT EXISTS wake_daily (app TEXT NOT NULL, day INTEGER NOT NULL, kind TEXT NOT NULL, name TEXT NOT NULL, provenance TEXT NOT NULL, path TEXT NOT NULL, source TEXT NOT NULL, campaign TEXT NOT NULL, count INTEGER NOT NULL, PRIMARY KEY(app,day,kind,name,provenance,path,source,campaign));
    CREATE TABLE IF NOT EXISTS wake_members (app TEXT NOT NULL, day INTEGER NOT NULL, visitor_id TEXT NOT NULL, name TEXT NOT NULL, provenance TEXT NOT NULL, PRIMARY KEY(app,day,visitor_id,name,provenance));
    CREATE INDEX IF NOT EXISTS wake_members_visitor ON wake_members(app,visitor_id,day);
    CREATE TABLE IF NOT EXISTS wake_visitors (app TEXT NOT NULL, visitor_id TEXT NOT NULL, first_at INTEGER NOT NULL, last_at INTEGER NOT NULL, first_touch TEXT NOT NULL, last_touch TEXT NOT NULL, PRIMARY KEY(app,visitor_id));
    CREATE TABLE IF NOT EXISTS wake_sessions (app TEXT NOT NULL, session_id TEXT NOT NULL, visitor_id TEXT NOT NULL, started_at INTEGER NOT NULL, last_at INTEGER NOT NULL, PRIMARY KEY(app,session_id));
    CREATE INDEX IF NOT EXISTS wake_sessions_time ON wake_sessions(app,started_at);
    CREATE TABLE IF NOT EXISTS wake_deleted_visitors (app TEXT NOT NULL, visitor_id TEXT NOT NULL, expires_at INTEGER NOT NULL, PRIMARY KEY(app,visitor_id));
    CREATE TABLE IF NOT EXISTS wake_runtime_stats (app TEXT NOT NULL, runtime_id TEXT NOT NULL, dropped INTEGER NOT NULL, rejected INTEGER NOT NULL, failed_delivery INTEGER NOT NULL, last_seen INTEGER NOT NULL, PRIMARY KEY(app,runtime_id));
    CREATE TABLE IF NOT EXISTS wake_health (app TEXT PRIMARY KEY, received INTEGER NOT NULL DEFAULT 0, duplicates INTEGER NOT NULL DEFAULT 0, rejected INTEGER NOT NULL DEFAULT 0, dropped INTEGER NOT NULL DEFAULT 0, failed_delivery INTEGER NOT NULL DEFAULT 0, last_event_at INTEGER, last_maintenance_at INTEGER);
  `)
  const columns = db.prepare('PRAGMA table_info(wake_events)').all()
  if (!columns.some((c) => c.name === 'aggregated'))
    db.exec(
      'ALTER TABLE wake_events ADD COLUMN aggregated INTEGER NOT NULL DEFAULT 0'
    )
  db.exec(
    'CREATE INDEX IF NOT EXISTS wake_events_pending ON wake_events(aggregated,id)'
  )
  if (!columns.some((c) => c.name === 'properties'))
    db.exec(
      "ALTER TABLE wake_events ADD COLUMN properties TEXT NOT NULL DEFAULT '{}'"
    )
}
function health(db, app, key, count) {
  if (
    ![
      'received',
      'duplicates',
      'rejected',
      'dropped',
      'failed_delivery'
    ].includes(key)
  )
    return
  db.prepare(
    `INSERT INTO wake_health(app,${key}) VALUES(?,?) ON CONFLICT(app) DO UPDATE SET ${key}=${key}+excluded.${key}`
  ).run(app, count)
}
function aggregate(db, app, event) {
  const day = Math.floor(event.occurredAt / DAY) * DAY
  const source =
    event.dimensions.campaign?.utm_source ||
    (event.dimensions.referrer
      ? new URL(event.dimensions.referrer).hostname
      : 'Direct')
  db.prepare(
    `INSERT INTO wake_daily VALUES(?,?,?,?,?,?,?,?,1) ON CONFLICT(app,day,kind,name,provenance,path,source,campaign) DO UPDATE SET count=count+1`
  ).run(
    app,
    day,
    event.kind,
    event.name,
    event.provenance,
    event.path,
    source,
    event.dimensions.campaign?.utm_campaign || ''
  )
  if (event.visitorId) {
    db.prepare('INSERT OR IGNORE INTO wake_members VALUES(?,?,?,?,?)').run(
      app,
      day,
      event.visitorId,
      event.name,
      event.provenance
    )
    const touch = JSON.stringify({ path: event.path, ...event.dimensions })
    db.prepare(
      `INSERT INTO wake_visitors VALUES(?,?,?,?,?,?) ON CONFLICT(app,visitor_id) DO UPDATE SET first_touch=CASE WHEN excluded.first_at<first_at THEN excluded.first_touch ELSE first_touch END, last_touch=CASE WHEN excluded.last_at>=last_at THEN excluded.last_touch ELSE last_touch END,first_at=MIN(first_at,excluded.first_at),last_at=MAX(last_at,excluded.last_at)`
    ).run(
      app,
      event.visitorId,
      event.occurredAt,
      event.occurredAt,
      touch,
      touch
    )
    if (event.sessionId)
      db.prepare(
        `INSERT INTO wake_sessions VALUES(?,?,?,?,?) ON CONFLICT(app,session_id) DO UPDATE SET started_at=MIN(started_at,excluded.started_at),last_at=MAX(last_at,excluded.last_at)`
      ).run(
        app,
        event.sessionId,
        event.visitorId,
        event.occurredAt,
        event.occurredAt
      )
  }
}
function ingest(scope, events, now = Date.now()) {
  const db = database()
  return db.transaction(() => {
    let accepted = 0,
      duplicates = 0,
      dropped = 0
    for (const event of events) {
      if (
        event.visitorId &&
        db
          .prepare(
            'SELECT 1 FROM wake_deleted_visitors WHERE app=? AND visitor_id=? AND expires_at>?'
          )
          .get(scope.app, visitorHash(scope.app, event.visitorId), now)
      ) {
        dropped++
        continue
      }
      const result = db
        .prepare(
          `INSERT INTO wake_events(app,environment,deployment,event_id,kind,name,occurred_at,received_at,path,visitor_id,session_id,host_user_id,dimensions,provenance,properties,aggregated) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,1) ON CONFLICT(app,event_id) DO NOTHING`
        )
        .run(
          scope.app,
          scope.environment,
          scope.deployment,
          event.id,
          event.kind,
          event.name,
          event.occurredAt,
          now,
          event.path,
          event.visitorId,
          event.sessionId,
          event.hostUserId,
          JSON.stringify(event.dimensions),
          event.provenance,
          JSON.stringify(event.properties || {})
        )
      if (!result.changes) {
        duplicates++
        continue
      }
      accepted++
      aggregate(db, scope.app, event)
    }
    health(db, scope.app, 'received', accepted)
    health(db, scope.app, 'duplicates', duplicates)
    health(db, scope.app, 'dropped', dropped)
    db.prepare(
      'UPDATE wake_health SET last_event_at=? WHERE app=? AND ?>0'
    ).run(now, scope.app, accepted)
    return { accepted, duplicates, dropped }
  })()
}
function revenue(scope, input, app, now = Date.now()) {
  const value = payment(input, now),
    db = database()
  const key = value.adjustmentId
    ? 'refund:' + value.adjustmentId
    : 'payment:' + value.transactionId
  return db.transaction(() => {
    const prior = db
      .prepare('SELECT * FROM wake_receipts WHERE app=? AND receipt_key=?')
      .get(scope.app, key)
    if (prior) {
      if (
        prior.transaction_id !== value.transactionId ||
        prior.amount !== value.amount ||
        prior.currency !== value.currency ||
        prior.occurred_at !== value.occurredAt
      )
        throw failure('conflict')
      return { receipt: key, duplicate: true }
    }
    let visitorId =
      app.wakeSettings?.mode === 'cookieless'
        ? null
        : readAttribution(value.attributionId, app.wakeSecret, scope.app, now)
    if (
      visitorId &&
      db
        .prepare(
          'SELECT 1 FROM wake_deleted_visitors WHERE app=? AND visitor_id=?'
        )
        .get(scope.app, visitorHash(scope.app, visitorId))
    )
      visitorId = null
    if (value.adjustmentId) {
      const original = db
        .prepare('SELECT * FROM wake_receipts WHERE app=? AND receipt_key=?')
        .get(scope.app, 'payment:' + value.transactionId)
      if (!original) throw failure('unknown_transaction')
      const refunded = db
        .prepare(
          'SELECT COALESCE(SUM(amount),0) AS amount FROM wake_receipts WHERE app=? AND transaction_id=? AND adjustment_id IS NOT NULL'
        )
        .get(scope.app, value.transactionId).amount
      if (
        original.currency !== value.currency ||
        refunded + value.amount > original.amount ||
        value.occurredAt < original.occurred_at
      )
        throw failure('invalid_refund')
      visitorId = original.visitor_id
    }
    db.prepare('INSERT INTO wake_receipts VALUES(?,?,?,?,?,?,?,?,?)').run(
      scope.app,
      key,
      value.transactionId,
      value.adjustmentId || null,
      value.amount,
      value.currency,
      value.occurredAt,
      now,
      visitorId
    )
    return { receipt: key, duplicate: false }
  })()
}
function deleteVisitor(app, visitorId, now = Date.now()) {
  const db = database()
  return db.transaction(() => {
    for (const table of [
      'wake_events',
      'wake_members',
      'wake_visitors',
      'wake_sessions'
    ])
      db.prepare(`DELETE FROM ${table} WHERE app=? AND visitor_id=?`).run(
        app,
        visitorId
      )
    db.prepare(
      'UPDATE wake_receipts SET visitor_id=NULL WHERE app=? AND visitor_id=?'
    ).run(app, visitorId)
    db.prepare(
      'INSERT INTO wake_deleted_visitors VALUES(?,?,?) ON CONFLICT(app,visitor_id) DO UPDATE SET expires_at=excluded.expires_at'
    ).run(app, visitorHash(app, visitorId), now + 90 * DAY)
  })()
}
const TABLES = [
  'wake_events',
  'wake_connections',
  'wake_budgets',
  'wake_receipts',
  'wake_daily',
  'wake_members',
  'wake_visitors',
  'wake_sessions',
  'wake_deleted_visitors',
  'wake_health',
  'wake_runtime_stats'
]
function deleteApp(app) {
  const db = database()
  db.transaction(() => {
    for (const table of TABLES)
      db.prepare(`DELETE FROM ${table} WHERE app=?`).run(String(app))
  })()
}
function maintain(now = Date.now()) {
  const db = database(),
    cutoff = now - RETENTION_DAYS * DAY
  return db.transaction(() => {
    const pending = db
      .prepare(
        'SELECT * FROM wake_events WHERE aggregated=0 ORDER BY id LIMIT 1000'
      )
      .all()
    for (const row of pending) {
      aggregate(db, row.app, {
        kind: row.kind,
        name: row.name,
        provenance: row.provenance,
        path: row.path,
        occurredAt: row.occurred_at,
        visitorId: row.visitor_id,
        sessionId: row.session_id,
        dimensions: JSON.parse(row.dimensions)
      })
      db.prepare('UPDATE wake_events SET aggregated=1 WHERE id=?').run(row.id)
    }
    // Aggregates and exact daily membership are committed with each event. A crash
    // cannot prune an event whose aggregate failed to commit.
    for (const [table, column, bound] of [
      ['wake_events', 'occurred_at', Math.floor((now - 30 * DAY) / DAY) * DAY],
      ['wake_receipts', 'occurred_at', cutoff],
      ['wake_daily', 'day', Math.floor(cutoff / DAY) * DAY],
      ['wake_members', 'day', Math.floor(cutoff / DAY) * DAY],
      ['wake_visitors', 'last_at', cutoff],
      ['wake_sessions', 'last_at', cutoff],
      ['wake_deleted_visitors', 'expires_at', now],
      ['wake_runtime_stats', 'last_seen', cutoff]
    ]) {
      db.prepare(
        `DELETE FROM ${table} WHERE rowid IN (SELECT rowid FROM ${table} WHERE ${column}<? ${
          table === 'wake_events' ? 'AND aggregated=1' : ''
        } LIMIT 5000)`
      ).run(bound)
    }
    db.prepare('UPDATE wake_health SET last_maintenance_at=?').run(now)
  })()
}
function runtimeStats(app, id, stats) {
  if (
    !/^[a-f0-9]{32}$/.test(id) ||
    !stats ||
    Object.keys(stats).some(
      (k) => !['dropped', 'rejected', 'failedDelivery'].includes(k)
    )
  )
    throw failure('invalid_stats')
  for (const key of ['dropped', 'rejected', 'failedDelivery'])
    if (
      !Number.isSafeInteger(stats[key]) ||
      stats[key] < 0 ||
      stats[key] > 1e12
    )
      throw failure('invalid_stats')
  const db = database()
  db.transaction(() => {
    const previous =
      db
        .prepare(
          'SELECT * FROM wake_runtime_stats WHERE app=? AND runtime_id=?'
        )
        .get(app, id) || {}
    for (const [input, key] of [
      ['dropped', 'dropped'],
      ['rejected', 'rejected'],
      ['failedDelivery', 'failed_delivery']
    ])
      health(db, app, key, Math.max(0, stats[input] - (previous[key] || 0)))
    db.prepare(
      'INSERT INTO wake_runtime_stats VALUES(?,?,?,?,?,?) ON CONFLICT(app,runtime_id) DO UPDATE SET dropped=MAX(dropped,excluded.dropped),rejected=MAX(rejected,excluded.rejected),failed_delivery=MAX(failed_delivery,excluded.failed_delivery),last_seen=excluded.last_seen'
    ).run(
      app,
      id,
      stats.dropped,
      stats.rejected,
      stats.failedDelivery,
      Date.now()
    )
  })()
}
module.exports = {
  database,
  schema,
  health,
  ingest,
  revenue,
  deleteVisitor,
  deleteApp,
  maintain,
  TABLES,
  runtimeStats
}
