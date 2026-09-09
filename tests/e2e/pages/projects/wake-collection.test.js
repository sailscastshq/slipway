const { test } = require('sounding')
const assert = require('node:assert/strict')
const wakeHost = require('../../../support/wake-host')
let number = 0
const options = () => ({
  browser: true,
  world: {
    name: 'configured-slipway',
    context: { deploymentTarget: { slug: `wake-collection-${++number}` } }
  }
})
async function flush(page) {
  await page.raw.evaluate(() => window.slipway.wake.flush())
}

test(
  'Wake consent gates tracking, deduplicates SPA navigation and supports creator sessions',
  options(),
  async ({ sails, world, page, expect }) => {
    const target = await wakeHost(sails, world)
    try {
      await page.goto(
        target.origin +
          target.prefix +
          '/pricing?token=secret&utm_source=newsletter'
      )
      await expect(page.raw.locator('[data-slipway-wake]')).toHaveCount(1)
      await page.raw.waitForFunction(
        () => window.slipway?.wake?.getState().mode
      )
      assert.equal(
        (await page.raw.context().cookies()).some((cookie) =>
          cookie.name.startsWith('sw_wake_')
        ),
        false
      )
      assert.equal((await target.rows()).length, 0)
      await page.raw.evaluate(() => window.slipway.wake.consent(true))
      await page.raw.waitForFunction(
        () => window.slipway.wake.getState().active
      )
      await flush(page)
      let rows = await target.rows()
      assert.equal(rows.length, 1)
      assert.equal(rows[0].path, '/academy/pricing')
      assert.ok(!JSON.stringify(rows).includes('secret'))
      assert.equal(
        JSON.parse(rows[0].dimensions).campaign.utm_source,
        'newsletter'
      )
      const firstVisitor = rows[0].visitor_id
      const cookie = (await page.raw.context().cookies()).find((cookie) =>
        cookie.name.startsWith('sw_wake_')
      )
      assert.ok(cookie.httpOnly)
      await page.raw.evaluate(() => {
        history.pushState({}, '', '/academy/plans')
        history.replaceState({}, '', '/academy/plans?ignored=yes')
      })
      await flush(page)
      rows = await target.rows()
      assert.equal(rows.length, 2)
      await page.goto(
        target.origin + target.prefix + '/_fixture/login/creator-a'
      )
      await page.raw.waitForFunction(
        () => window.slipway?.wake?.getState().active
      )
      await flush(page)
      rows = await target.rows()
      assert.equal(rows.at(-1).host_user_id, 'creator-a')
      assert.equal(rows.at(-1).visitor_id, firstVisitor)
      await page.goto(
        target.origin + target.prefix + '/_fixture/login/creator-b'
      )
      await page.raw.waitForFunction(
        () => window.slipway?.wake?.getState().active
      )
      await flush(page)
      await flush(page)
      rows = await target.rows()
      assert.equal(rows.at(-1).host_user_id, 'creator-b')
      assert.notEqual(rows.at(-1).visitor_id, firstVisitor)
      await page.raw.evaluate(() => window.slipway.wake.consent(false))
      await page.raw.waitForTimeout(50)
      assert.equal(
        (await page.raw.context().cookies()).some((cookie) =>
          cookie.name.startsWith('sw_wake_')
        ),
        false
      )
      const count = (await target.rows()).length
      await page.raw.evaluate(() => {
        history.pushState({}, '', '/academy/private')
        window.slipway.wake.track('ignored')
      })
      await flush(page)
      assert.equal((await target.rows()).length, count)
    } finally {
      await target.close()
    }
  }
)

test(
  'Wake supports sessionless cookieless apps and rejects browser-forged identity',
  options(),
  async ({ sails, world, page, expect }) => {
    const target = await wakeHost(sails, world, {
      sessionless: true,
      mode: 'cookieless',
      requireConsent: false
    })
    try {
      await page.goto(target.origin + target.prefix + '/manual')
      await expect(page.raw.locator('[data-slipway-wake]')).toHaveCount(1)
      await page.raw.waitForFunction(
        () => window.slipway?.wake?.getState().active
      )
      await flush(page)
      await page.raw.getByRole('button', { name: 'Start checkout' }).click()
      await flush(page)
      const rows = await target.rows()
      assert.equal(rows.length, 2)
      assert.ok(
        rows.every(
          (row) =>
            row.visitor_id === null &&
            row.session_id === null &&
            row.host_user_id === null
        )
      )
      assert.equal((await page.raw.context().cookies()).length, 0)
      const forged = await page.raw.evaluate(
        async (prefix) =>
          (
            await fetch(prefix + '/_slipway/wake/events', {
              method: 'POST',
              headers: { 'content-type': 'application/json' },
              body: JSON.stringify({
                consent: true,
                events: [
                  {
                    id: crypto.randomUUID(),
                    kind: 'pageview',
                    occurredAt: Date.now(),
                    path: '/pricing',
                    hostUserId: 'forged'
                  }
                ]
              })
            })
          ).status,
        target.prefix
      )
      assert.equal(forged, 400)
    } finally {
      await target.close()
    }
  }
)

test(
  'Wake preserves CSRF, respects privacy signals, and fails closed on revocation',
  options(),
  async ({ sails, world, page }) => {
    const target = await wakeHost(sails, world, { requireConsent: false })
    try {
      await page.goto(target.origin + target.prefix + '/pricing')
      await page.raw.waitForFunction(
        () => window.slipway?.wake?.getState().active
      )
      await flush(page)
      const initial = (await target.rows()).length
      const protectedStatus = await page.raw.evaluate(
        async (prefix) =>
          (
            await fetch(prefix + '/protected', {
              method: 'POST',
              headers: { 'content-type': 'application/json' },
              body: '{}'
            })
          ).status,
        target.prefix
      )
      assert.equal(protectedStatus, 403)
      const huge = await page.raw.evaluate(
        async (prefix) =>
          (
            await fetch(prefix + '/_slipway/wake/events', {
              method: 'POST',
              headers: { 'content-type': 'application/json' },
              body: JSON.stringify({ huge: 'x'.repeat(20000) })
            })
          ).status,
        target.prefix
      )
      assert.equal(huge, 413)
      const foreign = await fetch(
        target.origin + target.prefix + '/_slipway/wake/events',
        {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            origin: 'https://evil.example'
          },
          body: JSON.stringify({ consent: true, events: [] })
        }
      )
      assert.equal(foreign.status, 403)
      await page.raw.context().setExtraHTTPHeaders({ 'sec-gpc': '1' })
      await page.reload()
      await page.raw.waitForFunction(
        () => window.slipway?.wake?.getState().mode
      )
      assert.equal(
        await page.raw.evaluate(() => window.slipway.wake.getState().active),
        false
      )
      assert.equal(
        (await page.raw.context().cookies()).some((cookie) =>
          cookie.name.startsWith('sw_wake_')
        ),
        false
      )
      assert.equal((await target.rows()).length, initial)
      await page.raw.context().setExtraHTTPHeaders({})
      await page.goto(target.origin + target.prefix + '/pricing')
      assert.equal(
        await page.raw.locator('[data-slipway-wake]').count(),
        1,
        'HTML must not reuse the no-script GPC response'
      )
      await page.raw.waitForFunction(
        () => window.slipway?.wake?.getState().active
      )
      await page.raw.evaluate(() => window.slipway.wake.consent(false))
      await page.reload()
      await page.raw.waitForFunction(
        () => window.slipway?.wake?.getState().mode
      )
      assert.equal(
        await page.raw.evaluate(() => window.slipway.wake.getState().active),
        false
      )
      await sails.models.app
        .updateOne({ id: target.app.id })
        .set({ wakeEnabled: false, wakeSecret: null })
      await target.host.hooks.slipway.wake.refresh()
      assert.equal(target.host.hooks.slipway.wake.getStatus(), 'revoked')
      assert.equal(target.host.hooks.slipway.wake.getStats().queued, 0)
    } finally {
      await target.close()
    }
  }
)

test(
  'Wake leaves strict CSP and streamed HTML intact, and supports anonymous first-party sessions',
  options(),
  async ({ sails, world, page, expect }) => {
    const target = await wakeHost(sails, world, {
      sessionless: true,
      requireConsent: false
    })
    try {
      const strict = await fetch(target.origin + target.prefix + '/strict')
      assert.equal(
        strict.headers.get('content-security-policy'),
        "script-src 'none'"
      )
      assert.ok(!(await strict.text()).includes('data-slipway-wake'))
      const stream = await fetch(target.origin + target.prefix + '/stream')
      assert.equal(await stream.text(), '<html><body>Streamed</body></html>')
      await page.goto(target.origin + target.prefix + '/pricing')
      await page.raw.waitForFunction(
        () => window.slipway?.wake?.getState().active
      )
      await flush(page)
      const first = (await target.rows()).at(-1)
      assert.ok(first.visitor_id && first.session_id)
      assert.equal(first.host_user_id, null)
      const cookies = await page.raw.context().cookies()
      assert.deepEqual(
        cookies.map((cookie) => cookie.name),
        [`sw_wake_${target.app.id}`]
      )
      await page.reload()
      await page.raw.waitForFunction(
        () => window.slipway?.wake?.getState().active
      )
      await flush(page)
      assert.equal((await target.rows()).at(-1).visitor_id, first.visitor_id)
      await expect(
        page.raw.getByRole('heading', { name: 'Creator workspace' })
      ).toBeVisible()
    } finally {
      await target.close()
    }
  }
)
