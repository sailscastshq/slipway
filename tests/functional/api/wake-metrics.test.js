const { test } = require('sounding'),
  assert = require('node:assert/strict')
const store = require('../../../api/lib/wake-store'),
  reports = require('../../../api/lib/wake-report'),
  { DAY } = require('../../../packages/hook/lib/wake-value-contract')
test(
  'Wake UTC ranges, nonadditive uniques, late events, backfill, deletion and restart-safe retention have fixed totals',
  {
    world: {
      name: 'configured-slipway',
      context: { deploymentTarget: { slug: 'wake-metrics' } }
    }
  },
  async ({ sails, world }) => {
    await sails.helpers.wake.ensureSchema()
    const app = world.current.apps.web,
      id = String(app.id),
      day = Math.floor(Date.now() / DAY) * DAY,
      scope = { app: id, environment: String(app.environment), deployment: '1' }
    const event = (
      key,
      at,
      visitor,
      name = 'pageview',
      provenance = 'browser'
    ) => ({
      id: key,
      kind: name === 'pageview' ? 'pageview' : 'goal',
      name,
      occurredAt: at,
      path: '/pricing',
      visitorId: visitor,
      sessionId: 'session_' + visitor,
      hostUserId: null,
      dimensions: { referrer: '', campaign: {} },
      provenance
    })
    store.ingest(scope, [
      event('metric_0001', day - 2 * DAY, 'visitor_0001'),
      event('metric_0002', day - DAY, 'visitor_0001'),
      event('metric_0003', day - DAY, 'visitor_0002'),
      event('metric_0004', day - DAY, 'visitor_0001', 'signup', 'server'),
      event('metric_0005', day - DAY, 'visitor_0002', 'signup', 'browser')
    ])
    const filters = { from: day - 2 * DAY, to: day, currency: 'USD' }
    let report = reports.report(app, filters)
    assert.equal(report.visitors, 2)
    assert.equal(report.signups, 1)
    assert.equal(report.conversion, 0.5)
    assert.equal(report.sessions, 2)
    store.ingest(scope, [event('metric_late', day - 2 * DAY, 'visitor_0003')])
    report = reports.report(app, filters)
    assert.equal(report.visitors, 3)
    assert.equal(report.trend[0].pageviews, 2)
    // Simulate a retained event written by the previous schema: bounded backfill
    // must make it reportable once, including after a repeated maintenance run.
    store
      .database()
      .prepare(
        'INSERT INTO wake_events(app,environment,deployment,event_id,kind,name,occurred_at,received_at,path,dimensions,provenance) VALUES(?,?,?,?,?,?,?,?,?,?,?)'
      )
      .run(
        id,
        scope.environment,
        '1',
        'old_schema_event',
        'pageview',
        'pageview',
        day - DAY,
        day,
        '/legacy',
        '{}',
        'browser'
      )
    store.maintain(day + 32 * DAY)
    store.maintain(day + 32 * DAY)
    report = reports.report(app, filters)
    assert.equal(
      report.trend.reduce((n, d) => n + d.pageviews, 0),
      5
    )
    assert.equal(report.visitors, 3)
    assert.equal(
      store
        .database()
        .prepare('SELECT COUNT(*) AS n FROM wake_events WHERE app=?')
        .get(id).n,
      0
    )
    store.deleteVisitor(id, 'visitor_0001', day + 32 * DAY)
    assert.equal(reports.report(app, filters).visitors, 2)
    assert.equal(
      store.ingest(
        scope,
        [event('deleted_retry', day, 'visitor_0001')],
        day + 32 * DAY
      ).dropped,
      1
    )
    store.maintain(day + 400 * DAY)
    assert.equal(reports.report(app, filters).visitors, 0)
    assert.throws(() => reports.range({ from: '2026-02-30' }))
    assert.throws(() => reports.range({ from: '2020-01-01' }))
    const parsed = reports.range({
      from: new Date(day - DAY).toISOString().slice(0, 10),
      to: new Date(day).toISOString().slice(0, 10)
    })
    assert.equal(parsed.from, day - DAY)
    assert.equal(parsed.to, day + DAY)
  }
)
