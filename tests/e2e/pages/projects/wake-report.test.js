const { test } = require('sounding')
const assert = require('node:assert/strict')
const fs = require('node:fs/promises')
const path = require('node:path')
const store = require('../../../../api/lib/wake-store')
const value = require('../../../../packages/hook/lib/wake-value-contract')
const { withCsrfFromPage } = require('../../../support/csrf-request')
test(
  'Wake Overview, Journeys and Settings preserve scope, URL filters, Klean fields and mobile layout',
  {
    browser: true,
    world: {
      name: 'configured-slipway',
      context: { deploymentTarget: { slug: 'wake-report' } }
    }
  },
  async ({ sails, world, page, expect, login, request }) => {
    await sails.helpers.wake.ensureSchema()
    const app = world.current.apps.web,
      now = Date.now(),
      secret = 'swk_' + 'd'.repeat(64)
    await sails.models.app
      .updateOne({ id: app.id })
      .set({ wakeEnabled: true, wakeSecret: secret })
    const scope = {
      app: String(app.id),
      environment: String(app.environment),
      deployment: '1'
    }
    const dimensions = {
      referrer: '',
      campaign: {
        utm_source: 'Sailscasts',
        utm_campaign:
          'launch-week-for-creators-with-a-very-long-name-that-must-wrap'
      },
      device: 'desktop',
      country: 'Unknown'
    }
    store.ingest(scope, [
      {
        id: 'report_page_12345',
        kind: 'pageview',
        name: 'pageview',
        path: '/pricing',
        occurredAt: now,
        visitorId: 'a'.repeat(32),
        sessionId: 'b'.repeat(32),
        hostUserId: null,
        dimensions,
        provenance: 'browser'
      },
      {
        id: 'report_signup_12345',
        kind: 'goal',
        name: 'signup',
        path: '/signup',
        occurredAt: now,
        visitorId: 'a'.repeat(32),
        sessionId: 'b'.repeat(32),
        hostUserId: null,
        dimensions,
        provenance: 'server'
      }
    ])
    store.revenue(
      scope,
      {
        transactionId: 'payment-1',
        amount: 9900,
        currency: 'USD',
        occurredAt: now,
        attributionId: value.attribution(secret, scope.app, 'a'.repeat(32))
      },
      { wakeSecret: secret }
    )
    store
      .database()
      .prepare('INSERT OR REPLACE INTO wake_connections VALUES(?,?,?,?,?,?,?)')
      .run(scope.app, scope.environment, '1', '0.0.10', 3, 1, now)
    const base = `/projects/wake-report/environments/production/apps/${app.slug}/wake`,
      output = path.resolve('output/issue-499')
    await fs.mkdir(output, { recursive: true })
    await login.withPassword('genesisUser', page, {
      password: world.current.auth.genesisUserPassword
    })
    for (const tab of ['overview', 'journeys', 'settings']) {
      await page.goto(
        base +
          `?tab=${tab}` +
          (tab === 'journeys' ? '&visitor=' + 'a'.repeat(32) : '')
      )
      await expect(
        page.raw.getByRole('heading', { name: 'Wake', exact: true })
      ).toBeVisible()
      await expect(
        page.raw.getByRole('navigation', { name: 'Breadcrumb' })
      ).toBeVisible()
      for (const [width, colorScheme] of [
        [1280, 'light'],
        [390, 'dark']
      ]) {
        await page.raw.setViewportSize({ width, height: 1000 })
        await page.raw.emulateMedia({ colorScheme })
        assert.equal(
          await page.raw.evaluate(
            () => document.documentElement.scrollWidth <= innerWidth
          ),
          true
        )
        await page.screenshot(path.join(output, `${tab}-${width}.png`), {
          animations: 'disabled'
        })
      }
    }
    await page.goto(base)
    await page.raw
      .getByRole('combobox', { name: 'Currency', exact: true })
      .click()
    await page.raw.getByRole('option', { name: 'EUR', exact: true }).click()
    await page.raw.getByRole('button', { name: 'Apply', exact: true }).click()
    await expect(page.raw).toHaveURL(/currency=EUR/)
    await page.raw.reload()
    await expect(
      page.raw.getByRole('combobox', { name: 'Currency', exact: true })
    ).toContainText('EUR')
    await page.goto(base + '?tab=settings')
    assert.equal(
      await page.raw
        .getByLabel('Privacy mode', { exact: true })
        .evaluate((el) => getComputedStyle(el).borderBottomStyle),
      'dashed'
    )
    const api = (await withCsrfFromPage(request, '/', 'genesisUser')).request
    assert.equal(
      (await api.get(base.replace('wake-report', 'unowned'))).status,
      403
    )
    await page.raw
      .getByLabel('Additional allowed origins', { exact: true })
      .fill('https://example.test')
    await page.raw
      .getByRole('button', { name: 'Save settings', exact: true })
      .click()
    await expect(
      page.raw.getByText(
        'Saved. Redeploy this app to activate the new settings.',
        { exact: true }
      )
    ).toBeVisible()
    await page.goto(base + '?tab=settings')
    await expect(
      page.raw.getByText('Waiting for redeploy.', { exact: false })
    ).toBeVisible()
    await page.goto(base + '?from=2020-01-01')
    await expect(page.raw.getByRole('alert')).toContainText(
      'The date or currency filter is invalid'
    )
    sails.wakeStorageReady = false
    try {
      await page.goto(base)
      await expect(
        page.raw.getByText('Collection is unavailable.', { exact: false })
      ).toBeVisible()
      await page.screenshot(path.join(output, 'unavailable-390.png'), {
        animations: 'disabled'
      })
    } finally {
      sails.wakeStorageReady = true
    }
  }
)
