const { test } = require('sounding')
const fs = require('node:fs')
const path = require('node:path')

const phase = process.env.SETTINGS_PREFETCH_REVIEW_PHASE || 'after'

test(
  'settings prefetch stays selective and Updates waits for an explicit visit',
  { browser: true, world: 'configured-slipway' },
  async ({ world, login, page, expect }) => {
    await page.raw.route('**/api/v1/system/check-update', (route) =>
      route.fulfill({ json: { updateAvailable: false } })
    )
    await login.withPassword('genesisUser', page, {
      password: world.current.auth.genesisUserPassword
    })
    await page.raw.waitForURL('**/')
    const requests = []
    page.raw.on('request', (request) => {
      if (
        request.method() === 'GET' &&
        new URL(request.url()).pathname.startsWith('/settings/')
      ) {
        requests.push({
          path: new URL(request.url()).pathname,
          purpose: request.headers().purpose || 'visit'
        })
      }
    })
    await page.goto('/settings')
    await page.wait(200)
    expect(requests.length).toBe(0)
    for (const target of ['global-env', 'cli-tokens', 'audit-log', 'update']) {
      const link = page.raw.locator(`a[href="/settings/${target}"]`)
      await link.focus()
      await page.wait(100)
      expect(requests.length).toBe(0)
      await link.hover()
      await page.wait(200)
    }
    expect(requests).toEqual(
      phase === 'before'
        ? [{ path: '/settings/update', purpose: 'prefetch' }]
        : []
    )

    const instance = page.raw.locator('a[href="/settings/instance"]')
    const prefetched = page.raw.waitForResponse(
      (response) =>
        new URL(response.url()).pathname === '/settings/instance' &&
        response.request().headers().purpose === 'prefetch'
    )
    await instance.hover()
    await prefetched
    await instance.click()
    await page.raw.waitForURL('**/settings/instance')
    expect(
      requests.filter((request) => request.path === '/settings/instance')
    ).toEqual([{ path: '/settings/instance', purpose: 'prefetch' }])

    await page.goto('/settings')
    const update = page.raw.locator('a[href="/settings/update"]')
    await update.focus()
    await page.raw.keyboard.press('Enter')
    await page.raw.waitForURL('**/settings/update')
    expect(
      requests.filter((request) => request.path === '/settings/update').length
    ).toBe(phase === 'before' ? 2 : 1)
    const root = path.resolve('.tmp/audit', phase)
    fs.mkdirSync(root, { recursive: true })
    fs.writeFileSync(
      path.join(root, 'prefetch-requests.json'),
      JSON.stringify(requests, null, 2)
    )
    for (const width of [1440, 390]) {
      await page.resize(width, 1000)
      for (const scheme of ['light', 'dark']) {
        await (scheme === 'light' ? page.inLightMode() : page.inDarkMode())
        await page.goto('/settings')
        await page.screenshot(
          path.join(root, `settings-${width}-${scheme}.png`),
          { fullPage: true, animations: 'disabled' }
        )
      }
    }
    expect(page).toHaveNoSmoke()
  }
)
