const { test } = require('sounding')
const assert = require('node:assert/strict')
const supportHost = require('../../support/bridge-support-host')
test(
  'support host consumes one-time grants, isolates creator sessions, blocks writes/exports and preserves the normal login',
  {
    transport: 'http',
    world: {
      name: 'configured-slipway',
      context: { deploymentTarget: { slug: 'support-host' } }
    }
  },
  async ({ sails, world }) => {
    const target = await supportHost(sails, world)
    const { origin, app, issue } = target
    try {
      const login = await fetch(origin + '/login')
      const normalCookie = login.headers.get('set-cookie').split(';')[0]
      async function launch(code) {
        return fetch(origin + '/_slipway/bridge/impersonation/start', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', cookie: normalCookie },
          body: JSON.stringify({ code })
        })
      }
      const { code, grant } = await issue()
      const started = await launch(code)
      assert.equal(started.status, 200, await started.clone().text())
      const supportCookie = started.headers.get('set-cookie').split(';')[0]
      const cookies = normalCookie + '; ' + supportCookie
      assert.equal((await launch(code)).status, 403)
      const viewed = await fetch(origin + '/', { headers: { cookie: cookies } })
      const body = await viewed.text()
      assert.ok(body.includes('<h1>customer</h1>'), body)
      assert.ok(body.includes('slipway-support-banner'))
      assert.equal(viewed.headers.get('set-cookie'), null)
      assert.equal(viewed.headers.get('cache-control'), 'no-store')
      const original = await fetch(origin + '/', {
        headers: { cookie: normalCookie }
      })
      assert.ok((await original.text()).includes('<h1>operator</h1>'))
      assert.equal(
        (await fetch(origin + '/export', { headers: { cookie: cookies } }))
          .status,
        403
      )
      assert.equal(
        (await fetch(origin + '/write', { headers: { cookie: cookies } }))
          .status >= 400,
        true
      )
      assert.equal(target.writes(), 0)
      assert.equal(
        (
          await fetch(origin + '/', {
            method: 'POST',
            headers: { cookie: cookies }
          })
        ).status,
        403
      )
      const csp = await fetch(origin + '/csp', { headers: { cookie: cookies } })
      assert.equal(csp.status, 403)
      assert.ok(!(await csp.text()).includes('<body>private'))
      await assert.rejects(
        fetch(origin + '/raw', { headers: { cookie: cookies } })
      )
      const stopped = await fetch(
        origin + '/_slipway/bridge/impersonation/stop',
        { headers: { cookie: cookies }, redirect: 'manual' }
      )
      assert.equal(stopped.status, 303)
      assert.ok(
        !(stopped.headers.get('location') || '').includes('slipway:1337')
      )
      const normal = await fetch(origin + '/', {
        headers: { cookie: normalCookie }
      })
      assert.ok((await normal.text()).includes('<h1>operator</h1>'))
      const expired = await issue()
      await sails.models.bridgesupportgrant
        .updateOne({ id: expired.grant.id })
        .set({ expiresAt: Date.now() - 1 })
      await require('../../../scripts/expire-bridge-support').fn()
      assert.equal((await launch(expired.code)).status, 403)
      assert.equal(
        (
          await sails.models.bridgesupportgrant.findOne({
            id: expired.grant.id
          })
        ).status,
        'expired'
      )
      const revoked = await issue()
      const active = await launch(revoked.code)
      const revokedCookie =
        normalCookie + '; ' + active.headers.get('set-cookie').split(';')[0]
      await require('../../../api/lib/bridge-support-grants').revokeApp(app.id)
      await target.host.hooks.slipway.supportView.refresh()
      assert.equal(
        (await fetch(origin + '/', { headers: { cookie: revokedCookie } }))
          .status,
        403
      )
      const rotated = await issue()
      await sails.models.app
        .updateOne({ id: app.id })
        .set({ bridgeSecret: 'rotated-test-credential' })
      await require('../../../scripts/expire-bridge-support').fn()
      assert.equal(
        (
          await sails.models.bridgesupportgrant.findOne({
            id: rotated.grant.id
          })
        ).status,
        'revoked'
      )
      await sails.models.app
        .updateOne({ id: app.id })
        .set({ bridgeSecret: target.secret })
      const admin = await issue('admin')
      assert.equal((await launch(admin.code)).status, 403)
      const events = await sails.models.auditlog.find({
        resourceId: String(app.id)
      })
      assert.ok(events.some((e) => e.action === 'bridge.impersonation.started'))
      assert.ok(
        events.some((e) => e.action === 'bridge.impersonation.write_blocked')
      )
      assert.ok(!JSON.stringify(events).includes(code))
      assert.equal(
        (await sails.models.bridgesupportgrant.findOne({ id: grant.id }))
          .consumedAt > 0,
        true
      )
    } finally {
      await target.close()
    }
  }
)
