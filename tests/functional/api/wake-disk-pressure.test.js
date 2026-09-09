const { test } = require('sounding'),
  assert = require('node:assert/strict')
const store = require('../../../api/lib/wake-store')
test('a full SQLite analytics store rolls back reporting records and leaves the primary datastore usable', async ({
  sails
}) => {
  await sails.helpers.wake.ensureSchema()
  const original = sails.getDatastore.bind(sails),
    source = original('analytics').manager
  const limited = new source.constructor(':memory:')
  for (const row of source
    .prepare(
      "SELECT sql FROM sqlite_master WHERE type='table' AND name LIKE 'wake_%'"
    )
    .all())
    limited.exec(row.sql)
  store.schema(limited)
  const pages = limited.pragma('page_count', { simple: true })
  limited.pragma(`max_page_count=${pages + 3}`)
  sails.getDatastore = (name) =>
    name === 'analytics' ? { manager: limited } : original(name)
  let full = false,
    accepted = 0
  try {
    for (let n = 0; n < 100; n++) {
      try {
        store.ingest({ app: 'disk-test', environment: '1', deployment: '1' }, [
          {
            id: 'disk_event_' + n,
            kind: 'pageview',
            name: 'pageview',
            occurredAt: Date.now(),
            path: '/' + String(n) + 'x'.repeat(1800),
            visitorId: null,
            sessionId: null,
            hostUserId: null,
            dimensions: { campaign: {} },
            provenance: 'browser'
          }
        ])
        accepted++
      } catch (error) {
        assert.match(error.code || error.message, /SQLITE_FULL|full/i)
        full = true
        break
      }
    }
    assert.equal(full, true)
    assert.equal(
      limited.prepare('SELECT COUNT(*) AS n FROM wake_events').get().n,
      accepted
    )
    assert.equal(
      limited
        .prepare('SELECT COALESCE(SUM(count),0) AS n FROM wake_daily')
        .get().n,
      accepted
    )
    await original().sendNativeQuery('SELECT 1')
  } finally {
    sails.getDatastore = original
    limited.close()
  }
})
