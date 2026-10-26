const { test } = require('sounding')
const assert = require('node:assert/strict')
const fs = require('node:fs/promises')
const path = require('node:path')
const store = require('../../../../api/lib/wake-store')
const { DAY } = require('../../../../packages/hook/lib/wake-value-contract')

test(
  'Wake readiness, empty and retained reports work on desktop/mobile with durable filters, keyboard controls and interrupted requests',
  {
    browser: true,
    world: {
      name: 'configured-slipway',
      context: { deploymentTarget: { slug: 'wake-dashboard-ui' } }
    }
  },
  async ({ sails, world, page, expect, login }) => {
    await sails.helpers.wake.ensureSchema()
    const app = world.current.apps.web
    const base = `/projects/wake-dashboard-ui/environments/production/apps/${app.slug}/wake`
    const output = path.resolve('output/issue-869/after')
    await fs.mkdir(output, { recursive: true })
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
    const db = store.database()
    const scope = {
      app: String(app.id),
      environment: String(app.environment),
      deployment: '1'
    }
    const connect = (ready, protocol = 3, at = Date.now()) =>
      db
        .prepare(
          'INSERT OR REPLACE INTO wake_connections VALUES(?,?,?,?,?,?,?)'
        )
        .run(scope.app, scope.environment, '1', '0.0.10', protocol, ready, at)
    await login.withPassword('genesisUser', page, {
      password: world.current.auth.genesisUserPassword
    })
    const capture = async (name, heading, ready = false) => {
      for (const width of [1440, 390]) {
        await page.raw.setViewportSize({ width, height: 1000 })
        await page.raw.emulateMedia({
          colorScheme: width === 390 ? 'dark' : 'light'
        })
        await page.goto(base)
        await expect(
          page.raw.getByRole('heading', { name: heading, exact: true })
        ).toBeVisible()
        assert.equal(
          await page.raw.evaluate(
            () => document.documentElement.scrollWidth <= innerWidth
          ),
          true
        )
        if (!ready)
          await expect(
            page.raw.getByText('Recorded page loads', { exact: true })
          ).toHaveCount(0)
        await page.screenshot(path.join(output, `${name}-${width}.png`), {
          animations: 'disabled'
        })
      }
    }
    await capture('disabled', 'Wake is off')
    await expect(
      page.raw.getByText('Consent required before collection', { exact: false })
    ).toBeVisible()
    await sails.models.app.updateOne({ id: app.id }).set({ wakeEnabled: true })
    await capture('waiting', 'Waiting for redeploy')
    connect(0)
    await capture('unsupported', 'Hook update required')
    connect(1)
    await capture('empty', 'Ready for your first activity', true)
    await expect(
      page.raw.getByText('No visitors to measure', { exact: true })
    ).toBeVisible()
    // Repeated submits while the response is pending issue exactly one request.
    let calls = 0,
      release,
      entered
    const started = new Promise((resolve) => {
      entered = resolve
    })
    const gate = new Promise((resolve) => {
      release = resolve
    })
    await page.raw.route('**/wake?*', async (route) => {
      calls++
      entered()
      await gate
      await route.continue()
    })
    await page.raw
      .getByRole('form', { name: 'Report filters' })
      .evaluate((form) => {
        form.requestSubmit()
        form.requestSubmit()
      })
    await expect(
      page.raw.getByRole('button', { name: 'Loading…', exact: true })
    ).toBeDisabled()
    await started
    assert.equal(calls, 1)
    release()
    await expect(
      page.raw.getByRole('button', { name: 'Apply', exact: true })
    ).toBeEnabled()
    await page.raw.unroute('**/wake?*')
    // A failed request keeps local filter choices and restores the controls.
    const currency = page.raw.getByRole('combobox', {
      name: 'Currency',
      exact: true
    })
    await currency.click()
    await page.raw.getByRole('option', { name: 'EUR', exact: true }).click()
    await page.raw.route('**/wake?*', (route) => route.abort('failed'))
    await page.raw.getByRole('button', { name: 'Apply', exact: true }).click()
    await expect(page.raw.getByRole('alert')).toContainText(
      'Connection interrupted'
    )
    await expect(currency).toContainText('EUR')
    await expect(
      page.raw.getByRole('button', { name: 'Apply', exact: true })
    ).toBeEnabled()
    await page.raw.unroute('**/wake?*')
    await page.raw.getByRole('button', { name: 'Apply', exact: true }).click()
    await expect(page.raw).toHaveURL(/currency=EUR/)
    await page.raw.reload()
    await expect(currency).toContainText('EUR')
    await page.raw
      .getByRole('navigation', { name: 'Wake sections' })
      .getByRole('link', { name: 'settings' })
      .click()
    await expect(page.raw).toHaveURL(/tab=settings.*currency=EUR/)
    await expect(
      page.raw.getByRole('heading', {
        name: 'Collection & privacy',
        exact: true
      })
    ).toBeVisible()
    await page.raw.goBack()
    await expect(page.raw).toHaveURL(/tab=overview.*currency=EUR/)
    await expect(currency).toContainText('EUR')
    const today = Math.floor(Date.now() / DAY) * DAY
    for (let day = 0; day < 7; day++) {
      const count = [12, 18, 14, 26, 21, 35, 42][day]
      store.ingest(
        scope,
        Array.from({ length: count }, (_, index) => ({
          id: `showcase_${day}_${index}`,
          kind: 'pageview',
          name: 'pageview',
          path: ['/pricing', '/docs', '/'][index % 3],
          occurredAt: today - (6 - day) * DAY + 1000 + index,
          visitorId: `visitor_${day}_${index % 8}`,
          sessionId: `session_${day}_${index % 8}`,
          dimensions: {
            campaign: { utm_source: index % 2 ? 'Newsletter' : 'Community' }
          },
          provenance: 'browser'
        }))
      )
    }
    store.ingest(scope, [
      {
        id: 'showcase_signup',
        kind: 'goal',
        name: 'signup',
        path: '/signup',
        occurredAt: today + 1000,
        visitorId: 'visitor_6_0',
        sessionId: 'session_6_0',
        dimensions: { campaign: {} },
        provenance: 'server'
      }
    ])
    for (const [currency, amount] of [
      ['USD', 129900],
      ['JPY', 1234],
      ['KWD', 1234]
    ])
      store.revenue(
        scope,
        {
          transactionId: `showcase_${currency}`,
          currency,
          amount,
          occurredAt: today + 1000
        },
        {}
      )
    await capture('collecting', 'Runtime connected', true)
    await page.raw.setViewportSize({ width: 1440, height: 1000 })
    await page.raw.emulateMedia({ colorScheme: 'light' })
    await page.goto(base)
    await page.raw
      .getByRole('heading', { name: 'Revenue', exact: true })
      .scrollIntoViewIfNeeded()
    await page.screenshot(path.join(output, 'acquisition-value-1440.png'), {
      animations: 'disabled'
    })
    await expect(page.raw.getByText('$1,299.00', { exact: true })).toHaveCount(
      3
    )
    for (const [currency, fraction] of [
      ['JPY', '1,234'],
      ['KWD', '1.234']
    ]) {
      await page.goto(base + '?currency=' + currency)
      const section = page.raw.getByRole('region', {
        name: 'Revenue',
        exact: true
      })
      await expect(section).toContainText(fraction)
      await expect(section).not.toContainText('$1,299.00')
    }
    await page.goto(base)
    const counts = page.raw.getByText('View daily counts', { exact: true })
    await counts.focus()
    await page.raw.keyboard.press('Enter')
    await expect(page.raw.getByRole('table')).toBeVisible()
    const from = page.raw.getByLabel('From (UTC)', { exact: true })
    await from.focus()
    await page.raw.keyboard.press('ArrowDown')
    await expect(page.raw.getByRole('grid')).toBeVisible()
    await page.raw.keyboard.press('Escape')
    await expect(from).toBeFocused()
    await sails.models.app.updateOne({ id: app.id }).set({ wakeEnabled: false })
    await capture('retained-disabled', 'Wake is off', true)
    await sails.models.app.updateOne({ id: app.id }).set({
      wakeEnabled: true,
      wakeSettings: { ...settings, mode: 'cookieless' }
    })
    connect(1)
    await capture('cookieless', 'Runtime connected', true)
    await expect(
      page.raw
        .getByLabel('Activity metrics', { exact: true })
        .getByText('—', { exact: true })
    ).toHaveCount(3)
    await page.goto(base + '?tab=journeys')
    await expect(
      page.raw.getByText('Journeys are unavailable in cookieless mode.', {
        exact: true
      })
    ).toBeVisible()
    await expect(
      page.raw.getByRole('navigation', { name: 'Visitors', exact: true })
    ).toHaveCount(0)
    connect(1, 3, Date.now() - 121000)
    await capture('unavailable-retained', 'Collection is unavailable', true)
    sails.wakeStorageReady = false
    try {
      await capture('unavailable-storage', 'Reporting is unavailable')
      await page.goto(base + '?tab=journeys')
      await expect(
        page.raw.getByRole('heading', {
          name: 'Journeys are unavailable',
          exact: true
        })
      ).toBeVisible()
    } finally {
      sails.wakeStorageReady = true
    }
  }
)
