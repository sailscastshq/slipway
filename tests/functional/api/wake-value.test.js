const { test } = require('sounding')
const assert = require('node:assert/strict')
const crypto = require('node:crypto')
const value = require('../../../packages/hook/lib/wake-value-contract')
const store = require('../../../api/lib/wake-store')
test(
  'Wake commits concurrent receipts, rejects conflicts and excess refunds, separates currencies, and retains exact event membership',
  {
    transport: 'http',
    world: {
      name: 'configured-slipway',
      context: { deploymentTarget: { slug: 'wake-value' } }
    }
  },
  async ({ sails, world, request }) => {
    await sails.helpers.wake.ensureSchema()
    const app = world.current.apps.web,
      secret = 'swk_' + crypto.randomBytes(32).toString('hex')
    await sails.models.app
      .updateOne({ id: app.id })
      .set({ wakeEnabled: true, wakeSecret: secret })
    const deployment = await sails.models.deployment
      .create({ app: app.id, environment: app.environment })
      .fetch()
    const api = request.withHeaders({ authorization: 'Bearer ' + secret }),
      scope = { appId: String(app.id), deploymentId: String(deployment.id) }
    const visitor = 'a'.repeat(32),
      now = Date.now(),
      payment = {
        transactionId: 'pay_1',
        amount: 5000,
        currency: 'USD',
        occurredAt: now,
        attributionId: value.attribution(secret, String(app.id), visitor)
      }
    const send = (payment) =>
      api.post('/api/v1/wake/revenue', { ...scope, payment })
    const responses = await Promise.all([send(payment), send(payment)])
    assert.deepEqual(
      responses.map((r) => r.status),
      [200, 200],
      JSON.stringify(responses)
    )
    assert.equal(responses.filter((r) => r.data.duplicate).length, 1)
    assert.equal((await send({ ...payment, amount: 6000 })).status, 409)
    const refund = {
      transactionId: 'pay_1',
      adjustmentId: 'refund_1',
      amount: 1200,
      currency: 'USD',
      occurredAt: now
    }
    assert.equal((await send(refund)).status, 200)
    assert.equal((await send(refund)).data.duplicate, true)
    assert.equal(
      (await send({ ...refund, adjustmentId: 'refund_2', amount: 4000 }))
        .status,
      400
    )
    assert.equal(
      (
        await send({
          ...payment,
          transactionId: 'eur_1',
          currency: 'EUR',
          attributionId: 'invalid'
        })
      ).status,
      200
    )
    assert.equal(
      (
        await send({
          ...payment,
          transactionId: 'old_1',
          occurredAt: now - 397 * value.DAY
        })
      ).status,
      400
    )
    const rows = store
      .database()
      .prepare('SELECT * FROM wake_receipts WHERE app=?')
      .all(scope.appId)
    assert.equal(rows.length, 3)
    assert.equal(rows.find((r) => r.currency === 'EUR').visitor_id, null)
    assert.equal(
      rows.find((r) => r.receipt_key === 'payment:pay_1').visitor_id,
      visitor
    )
    const events = [0, 1].map((n) => ({
      id: 'event_' + n + '12345678',
      kind: 'pageview',
      path: '/pricing',
      occurredAt: now - n * value.DAY,
      visitorId: visitor,
      sessionId: 's'.repeat(32),
      provenance: 'browser'
    }))
    assert.equal(
      (await api.post('/api/v1/wake/ingest', { ...scope, events })).status,
      200
    )
    assert.equal(
      (await api.post('/api/v1/wake/ingest', { ...scope, events })).data
        .duplicates,
      2
    )
    assert.equal(
      store
        .database()
        .prepare('SELECT SUM(count) AS n FROM wake_daily WHERE app=?')
        .get(scope.appId).n,
      2
    )
    assert.equal(
      store
        .database()
        .prepare(
          'SELECT COUNT(DISTINCT visitor_id) AS n FROM wake_members WHERE app=?'
        )
        .get(scope.appId).n,
      1
    )
    store.maintain(now + 32 * value.DAY)
    store.maintain(now + 32 * value.DAY)
    assert.equal(
      store
        .database()
        .prepare('SELECT COUNT(*) AS n FROM wake_events WHERE app=?')
        .get(scope.appId).n,
      0
    )
    assert.equal(
      store
        .database()
        .prepare('SELECT SUM(count) AS n FROM wake_daily WHERE app=?')
        .get(scope.appId).n,
      2
    )
    store.deleteVisitor(scope.appId, visitor)
    assert.equal(
      store
        .database()
        .prepare('SELECT COUNT(*) AS n FROM wake_members WHERE app=?')
        .get(scope.appId).n,
      0
    )
    assert.equal(
      store
        .database()
        .prepare(
          'SELECT COUNT(*) AS n FROM wake_receipts WHERE app=? AND visitor_id IS NOT NULL'
        )
        .get(scope.appId).n,
      0
    )
    store.deleteApp(scope.appId)
    assert.equal(
      store
        .database()
        .prepare('SELECT COUNT(*) AS n FROM wake_receipts WHERE app=?')
        .get(scope.appId).n,
      0
    )
  }
)
