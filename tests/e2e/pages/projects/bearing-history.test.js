const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const { test } = require('sounding')
const bootstrap = require('../../../../api/controllers/bearing/view-bootstrap')

// Real bootstrap and browser document navigations; only host/config/content
// responses are fixtures. Never replace or intercept the browser history API.
async function hostFixture(page, { enabled = true, updates = true } = {}) {
  const prefix = '/__bearing-history'
  const surfaces = Object.fromEntries(
    ['feedback', 'roadmap', ...(updates ? ['updates'] : [])].map((view) => [
      view,
      { path: `${prefix}/${view}?embedded=1`, label: view }
    ])
  )
  const source = await bootstrap.fn.call({ res: { set() {} } })
  await page.raw.route(`**${prefix}/**`, async (route) => {
    const url = new URL(route.request().url())
    const view = url.pathname.slice(prefix.length + 1)
    if (view === 'bootstrap.js')
      return route.fulfill({
        contentType: 'application/javascript',
        body: source
      })
    if (view === 'widget-config')
      return route.fulfill({
        json: {
          enabled,
          space: 'history-proof',
          appName: 'Northstar',
          openingView: 'feedback',
          showUnread: true,
          latestUpdate: { publicId: 'update-history-proof' },
          surfaces
        }
      })
    let body
    if (view === 'before') {
      body = `<h1>Previous host page</h1><a href="${prefix}/host">Visit host</a>`
    } else if (view === 'host') {
      body = `<h1>Host account</h1>
        <button data-slipway-bearing-open="feedback">Share feedback</button>
        <button data-slipway-bearing-open="roadmap">Host roadmap</button>
        <a href="${prefix}/updates" data-slipway-bearing-open="updates">What's new</a>
        <script src="${prefix}/bootstrap.js"></script>`
    } else {
      body = `<h1>Embedded ${view}</h1><label>Draft<input aria-label="Draft"></label><button>Frame keyboard target</button>`
    }
    return route.fulfill({
      contentType: 'text/html',
      body: `<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"></head><body>${body}</body></html>`
    })
  })
  const configured = page.raw.waitForResponse((response) =>
    response.url().endsWith(`${prefix}/widget-config`)
  )
  await page.goto(`${prefix}/before`)
  await page.raw.getByRole('link', { name: 'Visit host' }).click()
  await configured
  const hostUrl = page.raw.url()
  const widget = page.raw.locator('[data-slipway-bearing-widget]')
  const state = () =>
    page.raw.evaluate(() => ({ url: location.href, history: history.length }))
  return { prefix, hostUrl, widget, state }
}

for (const project of ['desktop', 'mobile']) {
  test(
    `Bearing widget keeps host Back history across surface switches and reopen on ${project}`,
    { browser: { project } },
    async ({ page, expect }) => {
      const { prefix, hostUrl, widget, state } = await hostFixture(page)
      await expect(widget).toBeAttached()
      const original = await state()
      const measurements = [{ stage: 'host', ...original }]
      const panel = widget.locator('dialog')
      const frame = page.raw.frameLocator(
        '[data-slipway-bearing-widget] iframe'
      )
      const hostFeedback = page.raw.getByRole('button', {
        name: 'Share feedback'
      })
      async function loaded(view) {
        await expect(frame.getByRole('heading')).toHaveText(`Embedded ${view}`)
        await expect(widget.locator('iframe')).toHaveAttribute(
          'title',
          `Northstar ${view}`
        )
        const url = await frame.locator('body').evaluate(() => location.href)
        assert.equal(url, new URL(`${prefix}/${view}?embedded=1`, hostUrl).href)
        const current = await state()
        measurements.push({ stage: view, frameUrl: url, ...current })
        assert.deepEqual(current, original, `Host history after ${view}`)
      }
      await hostFeedback.focus()
      await page.raw.keyboard.press('Enter')
      await expect(panel).toBeVisible()
      await expect(widget.locator('[data-close]')).toBeFocused()
      await loaded('feedback')
      await frame.getByLabel('Draft').fill('Keep my unfinished feedback')
      await widget.locator('[data-close]').click()
      await expect(panel).toBeHidden()
      await expect(hostFeedback).toBeFocused()
      await page.raw.keyboard.press('Space')
      await loaded('feedback')
      await expect(frame.getByLabel('Draft')).toHaveValue(
        'Keep my unfinished feedback'
      )
      for (const view of [
        'roadmap',
        'updates',
        'feedback',
        'updates',
        'roadmap'
      ]) {
        await widget.locator(`[data-surface="${view}"]`).click()
        await loaded(view)
      }
      // Escape delivered inside the newly loaded frame must still close and
      // return focus to the genuine host opener after replacement navigation.
      await frame.getByRole('button').focus()
      await page.raw.keyboard.press('Escape')
      await expect(panel).toBeHidden()
      await expect(hostFeedback).toBeFocused()
      assert.deepEqual(await state(), original)
      for (let round = 0; round < 2; round++) {
        await page.raw
          .getByRole('link', { name: "What's new", exact: true })
          .click()
        await loaded('updates')
        await widget.locator('[data-close]').focus()
        await page.raw.keyboard.press('Shift+Tab')
        await expect(widget.locator('.bearing-powered-by')).toBeFocused()
        await page.raw.keyboard.press('Tab')
        await expect(widget.locator('[data-close]')).toBeFocused()
        await widget.locator('[data-close]').click()
        await expect(panel).toBeHidden()
        assert.deepEqual(await state(), original)
      }
      await hostFeedback.click()
      await loaded('feedback')
      await page.raw.evaluate(() => {
        for (const surface of ['roadmap', 'feedback', 'updates'])
          window.dispatchEvent(
            new CustomEvent('slipway:bearing:open', { detail: { surface } })
          )
      })
      await loaded('updates')
      const root = path.resolve(
        `.tmp/screenshots/issue-871-bearing-history/${project}`
      )
      fs.mkdirSync(root, { recursive: true })
      await page.screenshot(path.join(root, 'widget.png'))
      // One genuine browser Back must leave the host, not consume a hidden
      // iframe entry. Forward returns to the same host without extra entries.
      await page.raw.goBack()
      await expect(page.raw.getByRole('heading')).toHaveText(
        'Previous host page'
      )
      await expect(page.raw).toHaveURL(
        new URL(`${prefix}/before`, hostUrl).href
      )
      await page.raw.goForward()
      await expect(
        page.raw.getByRole('heading', { name: 'Host account' })
      ).toBeVisible()
      assert.deepEqual(await state(), original)
      fs.writeFileSync(
        path.join(root, 'history.json'),
        JSON.stringify(measurements, null, 2)
      )
    }
  )
}

test(
  'Bearing disabled widget and disabled surfaces preserve ordinary host navigation',
  { browser: true },
  async ({ page, expect }) => {
    await hostFixture(page, { enabled: false })
    await expect(page.raw.locator('[data-slipway-bearing-widget]')).toHaveCount(
      0
    )
    await page.raw
      .getByRole('link', { name: "What's new", exact: true })
      .click()
    await expect(page.raw.getByRole('heading')).toHaveText('Embedded updates')

    const { widget } = await hostFixture(page, { updates: false })
    await expect(widget).toBeAttached()
    await page.raw.getByRole('button', { name: 'Share feedback' }).click()
    await expect(widget.locator('[data-surface="updates"]')).toBeHidden()
    await widget.locator('[data-close]').click()
    await expect(widget.locator('dialog')).toBeHidden()
    await page.raw
      .getByRole('link', { name: "What's new", exact: true })
      .click()
    await expect(page.raw.getByRole('heading')).toHaveText('Embedded updates')
  }
)
