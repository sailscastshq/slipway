const { test } = require('sounding')
const assert = require('node:assert/strict')
const wakeHost = require('../../support/wake-host')
test(
  'sessionless checkout attribution, server signup, outage and durable payment replay work through the installed host helpers',
  {
    transport: 'http',
    world: {
      name: 'configured-slipway',
      context: { deploymentTarget: { slug: 'wake-host-value' } }
    }
  },
  async ({ sails, world }) => {
    const target = await wakeHost(sails, world, {
      sessionless: true,
      requireConsent: false
    })
    try {
      const capture = await fetch(
        target.origin + target.prefix + '/_slipway/wake/events',
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Origin: target.origin
          },
          body: JSON.stringify({
            consent: true,
            events: [
              {
                id: 'pageview_123456789',
                kind: 'pageview',
                occurredAt: Date.now(),
                path: target.prefix + '/pricing'
              }
            ]
          })
        }
      )
      assert.equal(capture.status, 202)
      const req = {
        headers: {
          cookie: capture.headers.get('set-cookie').split(';')[0],
          host: new URL(target.origin).host
        },
        url: target.prefix + '/pricing'
      }
      assert.equal(req.session, undefined)
      const token = await target.host.helpers.wake.attribution.with({ req })
      assert.equal(typeof token, 'string')
      assert.ok(token.length > 32)
      const result = await target.host.helpers.wake.track.with({
        name: 'signup',
        req,
        properties: { plan: 'pro' },
        eventId: 'signup_12345678'
      })
      assert.equal(result.accepted, true)
      const rows = await target.rows()
      assert.ok(
        rows.some(
          (r) =>
            r.name === 'signup' && r.provenance === 'server' && r.visitor_id
        )
      )
      const payment = {
        transactionId: 'sessionless-payment',
        amount: 1999,
        currency: 'USD',
        occurredAt: Date.now(),
        attributionId: token
      }
      sails.wakeStorageReady = false
      try {
        await assert.rejects(target.host.helpers.wake.revenue.with(payment))
      } finally {
        sails.wakeStorageReady = true
      }
      const receipt = await target.host.helpers.wake.revenue.with(payment)
      assert.equal(receipt.duplicate, false)
      assert.equal(
        (await target.host.helpers.wake.revenue.with(payment)).duplicate,
        true
      )
      const stored = sails
        .getDatastore('analytics')
        .manager.prepare('SELECT * FROM wake_receipts WHERE app=?')
        .all(String(target.app.id))
      assert.equal(stored.length, 1)
      assert.equal(stored[0].visitor_id, rows[0].visitor_id)
      assert.equal(
        await target.host.helpers.wake.attribution.with({
          req: { ...req, headers: { ...req.headers, cookie: 'tampered' } }
        }),
        null
      )
      assert.equal(
        (
          await target.host.helpers.wake.track.with({
            name: 'signup',
            req: { ...req, _slipwaySupportSession: {} },
            eventId: 'support_12345678'
          })
        ).accepted,
        false
      )
    } finally {
      await target.close()
    }
  }
)
