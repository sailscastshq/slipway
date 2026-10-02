const fs = require('node:fs')
const path = require('node:path')
const { test } = require('sounding')

test(
  'Bosun distinguishes allocated heap from process RSS and handles unavailable measurements',
  { browser: true, world: 'configured-slipway' },
  async ({ page, login, world, expect }) => {
    const originalMemoryUsage = process.memoryUsage
    let sample = {
      heapUsed: 170.2 * 1024 ** 2,
      heapTotal: 180.4 * 1024 ** 2,
      rss: 1.1 * 1024 ** 3
    }
    process.memoryUsage = Object.assign(
      () => ({ ...sample }),
      originalMemoryUsage
    )
    try {
      await page.raw.route('**/api/v1/system/check-update', (route) =>
        route.fulfill({ json: { updateAvailable: false } })
      )
      await login.withPassword('genesisUser', page, {
        password: world.current.auth.genesisUserPassword
      })
      await page.raw.waitForURL((url) => !url.pathname.startsWith('/login'))
      await page.goto('/bosun')
      const card = page.raw.locator('[data-test="bosun-memory"]')
      await expect(card).toBeVisible()
      await expect(card).toContainText('170.2 MB')
      await expect(card).toContainText('180.4 MB')
      await expect(card).toContainText('94% of allocated heap')
      await expect(card).toContainText('10.2 MB unused')
      await expect(card).toContainText('Slipway process (RSS)')
      await expect(card).toContainText('1.1 GB')
      for (const [selector, explanation] of [
        ['bosun-heap-help', 'not the server or container memory limit'],
        ['bosun-rss-help', 'Excludes other apps and server processes']
      ]) {
        const label = card.locator(`[data-test="${selector}"]`)
        await label.focus()
        await expect(page.raw.getByRole('tooltip')).toBeVisible()
        await expect(page.raw.getByRole('tooltip')).toContainText(explanation)
        await page.raw.keyboard.press('Escape')
        await expect(page.raw.getByRole('tooltip')).not.toBeVisible()
        await label.blur()
      }
      expect(await card.getByRole('meter').getAttribute('aria-valuenow')).toBe(
        '94'
      )
      const out = path.resolve('output/issue-560')
      fs.mkdirSync(out, { recursive: true })
      for (const [width, theme] of [
        [1280, 'light'],
        [390, 'dark']
      ]) {
        await page.raw.setViewportSize({ width, height: 900 })
        await page.raw.emulateMedia({ colorScheme: theme })
        await card.scrollIntoViewIfNeeded()
        await card.screenshot({
          path: path.join(out, `bosun-memory-${width}.png`),
          animations: 'disabled'
        })
        expect(
          await card.evaluate((node) => node.scrollWidth <= node.clientWidth)
        ).toBe(true)
      }
      for (const measurement of [
        { heapUsed: 0, heapTotal: 0, rss: 0 },
        { heapUsed: 20, heapTotal: 10, rss: -1 },
        { heapUsed: NaN, heapTotal: Infinity, rss: NaN },
        {}
      ]) {
        sample = measurement
        await page.goto('/bosun')
        await expect(card).toContainText('Heap utilization unavailable.')
        expect(await card.getByRole('meter').count()).toBe(0)
        const text = await card.innerText()
        expect(/NaN|Infinity|-10|undefined/.test(text)).toBe(false)
      }
      await expect(card).toContainText('Unavailable')
      expect(page).toHaveNoJavascriptErrors()
    } finally {
      process.memoryUsage = originalMemoryUsage
    }
  }
)

test(
  'Bosun environment saves keep failed edits and confirm successful writes',
  { browser: true, world: 'configured-slipway' },
  async ({ page, login, world, expect }) => {
    await login.withPassword('genesisUser', page, {
      password: world.current.auth.genesisUserPassword
    })
    await page.raw.waitForURL((url) => url.pathname === '/')
    await page.goto('/bosun?tab=environment')
    let fail = true
    await page.raw.route('**/api/v1/bosun/env', (route) =>
      route.fulfill({
        status: fail ? 503 : 200,
        json: fail
          ? { message: 'Environment storage is unavailable. Retry later.' }
          : { success: true }
      })
    )
    await page.raw
      .getByPlaceholder('KEY', { exact: true })
      .fill('CUSTOMER_MODE')
    await page.raw
      .getByPlaceholder('value', { exact: false })
      .fill('production')
    const toast = page.raw.locator(
      '[data-slot="toast"]:not([data-state="closing"])'
    )
    await page.raw.getByRole('button', { name: 'Add', exact: true }).click()
    await expect(toast).toContainText('Environment storage is unavailable')
    await expect(page.raw.getByPlaceholder('KEY', { exact: true })).toHaveValue(
      'CUSTOMER_MODE'
    )
    await expect(
      page.raw.getByText('CUSTOMER_MODE', { exact: true })
    ).toHaveCount(0)
    await toast.locator('button').click()
    fail = false
    await page.raw.getByRole('button', { name: 'Add', exact: true }).click()
    await expect(toast).toContainText('Environment variables saved')
    await expect(
      page.raw.getByText('CUSTOMER_MODE', { exact: true })
    ).toBeVisible()
    await expect(page.raw.getByPlaceholder('KEY', { exact: true })).toHaveValue(
      ''
    )
    expect(page).toHaveNoJavascriptErrors()
  }
)
