module.exports = {
  friendlyName: 'Ensure Wake analytics schema',
  inputs: {},
  fn: async function () {
    sails.wakeStorageReady = false
    if (sails.wakeStorageFallback)
      throw Error('Wake persistent storage is unavailable')
    const db = sails.getDatastore('analytics')
    db.manager.pragma('synchronous=FULL')
    db.manager.pragma('busy_timeout=100')
    db.manager.pragma('cache_size=-65536')
    await db.sendNativeQuery(`CREATE TABLE IF NOT EXISTS wake_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      app TEXT NOT NULL, environment TEXT NOT NULL, deployment TEXT NOT NULL,
      event_id TEXT NOT NULL, kind TEXT NOT NULL, name TEXT NOT NULL,
      occurred_at INTEGER NOT NULL, received_at INTEGER NOT NULL,
      path TEXT NOT NULL, visitor_id TEXT, session_id TEXT,
      UNIQUE(app, event_id)
    )`)
    await db.sendNativeQuery(`CREATE INDEX IF NOT EXISTS wake_events_scope_time
      ON wake_events(app, environment, occurred_at)`)
    await db.sendNativeQuery(`CREATE INDEX IF NOT EXISTS wake_events_visitor
      ON wake_events(app, environment, visitor_id, occurred_at)`)
    await db.sendNativeQuery(`CREATE TABLE IF NOT EXISTS wake_connections (
      app TEXT PRIMARY KEY, environment TEXT NOT NULL, deployment TEXT NOT NULL,
      hook_version TEXT NOT NULL, protocol INTEGER NOT NULL,
      collection_ready INTEGER NOT NULL DEFAULT 0, last_seen_at INTEGER NOT NULL
    )`)
    await db.sendNativeQuery(`CREATE TABLE IF NOT EXISTS wake_budgets (
      app TEXT PRIMARY KEY, window_start INTEGER NOT NULL,
      requests INTEGER NOT NULL DEFAULT 0, events INTEGER NOT NULL DEFAULT 0,
      bytes INTEGER NOT NULL DEFAULT 0, rejected INTEGER NOT NULL DEFAULT 0
    )`)
    const columns = await db.sendNativeQuery('PRAGMA table_info(wake_events)')
    const names = new Set(columns.rows.map((row) => row.name))
    for (const [name, definition] of [
      ['host_user_id', 'TEXT'],
      ['dimensions', "TEXT NOT NULL DEFAULT '{}'"],
      ['provenance', "TEXT NOT NULL DEFAULT 'runtime'"]
    ]) {
      if (!names.has(name))
        await db.sendNativeQuery(
          `ALTER TABLE wake_events ADD COLUMN ${name} ${definition}`
        )
    }
    require('../../lib/wake-store').schema(db.manager)
    sails.wakeStorageReady = true
  }
}
