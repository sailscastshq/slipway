const { test } = require('sounding')
const assert = require('node:assert/strict')
const store = require('../../../api/lib/wake-store')
const { withCsrfFromPage } = require('../../support/csrf-request')
const { DAY } = require('../../../packages/hook/lib/wake-value-contract')

test(
  'Wake page preserves retained history, collection states, consent, currency units and app/date scope without mutating settings',
  {
    world: {
      name: 'configured-slipway',
      context: { deploymentTarget: { slug: 'wake-dashboard' } }
    }
  },
  async ({ sails, world, request }) => {
    await sails.helpers.wake.ensureSchema()
    const app = world.current.apps.web
    const base = `/projects/wake-dashboard/environments/production/apps/${app.slug}/wake`
    const today = Math.floor(Date.now() / DAY) * DAY
    const text = (day) => new Date(day).toISOString().slice(0, 10)
    const settings = {
      mode: 'first-party',
      requireConsent: true,
      respectPrivacySignals: true,
      allowedOrigins: [],
      excludedPaths: []
    }
    await sails.models.app
      .updateOne({ id: app.id })
      .set({ wakeEnabled: false, wakeSettings: settings })
    const api = (await withCsrfFromPage(request, base, 'genesisUser')).request
    const read = async (suffix = '') => {
      const response = await api.get(base + suffix)
      assert.equal(response.status, 200)
      return response.data.props
    }
    let props = await read()
    assert.equal(props.state.state, 'disabled')
    assert.equal(props.report.visitors, 0)
    await sails.models.app.updateOne({ id: app.id }).set({ wakeEnabled: true })
    assert.equal((await read()).state.state, 'waiting_for_runtime')
    const scope = {
      app: String(app.id),
      environment: String(app.environment),
      deployment: '1'
    }
    const db = store.database()
    const connection = (ready, protocol = 3, at = Date.now()) =>
      db
        .prepare(
          'INSERT OR REPLACE INTO wake_connections VALUES(?,?,?,?,?,?,?)'
        )
        .run(scope.app, scope.environment, '1', '0.0.10', protocol, ready, at)
    connection(0)
    assert.equal((await read()).state.state, 'foundation_only')
    connection(1, 2)
    props = await read()
    assert.equal(props.state.state, 'collecting')
    assert.equal(props.state.valueReady, false)
    connection(1)
    store.ingest(scope, [
      {
        id: 'dashboard_page_001',
        kind: 'pageview',
        name: 'pageview',
        path: '/pricing',
        occurredAt: today,
        visitorId: 'dashboard_visitor',
        sessionId: 'dashboard_session',
        dimensions: { campaign: {} },
        provenance: 'browser'
      }
    ])
    for (const [transactionId, currency, amount] of [
      ['usd', 'USD', 1234],
      ['jpy', 'JPY', 1234],
      ['kwd', 'KWD', 1234]
    ]) {
      store.revenue(
        scope,
        { transactionId, currency, amount, occurredAt: today },
        {}
      )
    }
    for (const currency of ['USD', 'JPY', 'KWD']) {
      props = await read(
        `?from=${text(today)}&to=${text(today)}&currency=${currency}`
      )
      assert.equal(props.filters.currency, currency)
      assert.equal(props.report.revenue.net, 1234)
      assert.equal(props.report.trend.length, 1)
      assert.equal(props.report.trend[0].pageviews, 1)
    }
    props = await read(`?from=${text(today - DAY)}&to=${text(today - DAY)}`)
    assert.equal(props.report.visitors, 0)
    assert.equal(props.report.revenue.net, 0)
    await sails.models.app.updateOne({ id: app.id }).set({ wakeEnabled: false })
    props = await read()
    assert.equal(props.state.state, 'disabled')
    assert.equal(props.report.visitors, 1)
    await sails.models.app.updateOne({ id: app.id }).set({
      wakeEnabled: true,
      wakeSettings: { ...settings, mode: 'cookieless' }
    })
    props = await read('?tab=journeys')
    assert.equal(props.report.visitors, null)
    assert.equal(props.report.sessions, null)
    assert.equal(props.report.conversion, null)
    assert.equal(props.report.revenue.perVisitor, null)
    assert.deepEqual(props.journeys, { visitors: [], events: [], receipts: [] })
    connection(1, 3, Date.now() - 121000)
    props = await read()
    assert.equal(props.state.state, 'unavailable')
    assert.equal(props.report.trend.at(-1).pageviews, 1)
    assert.equal(
      (await api.get(base.replace('/production/', '/staging/'))).status,
      403
    )
    props = await read('?from=2020-01-01&currency=INVALID')
    assert.ok(props.filterError)
    assert.equal(props.filters.currency, 'USD')
    assert.equal(
      (await sails.models.app.findOne({ id: app.id })).wakeSettings
        .requireConsent,
      true
    )
    sails.wakeStorageReady = false
    try {
      props = await read('?tab=journeys')
      assert.equal(props.state.state, 'unavailable')
      assert.equal(props.report, null)
      assert.equal(props.journeys, null)
    } finally {
      sails.wakeStorageReady = true
    }
  }
)
