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
      await expect(card).toContainText('94% of allocated heap used')
      await expect(card).toContainText('10.2 MB unused in heap')
      await expect(card).toContainText('Slipway process memory (RSS)')
      await expect(card).toContainText('1.1 GB')
      await expect(card).toContainText(
        'not the server or container memory limit'
      )
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
