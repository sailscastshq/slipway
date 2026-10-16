const fs = require('node:fs')
const path = require('node:path')
const { test } = require('sounding')
test(
  'audit select uses the shared underline in light, dark and mobile and preserves keyboard selection',
  { browser: true, world: 'configured-slipway' },
  async ({ world, login, page, expect }) => {
    await page.raw.route('**/api/v1/system/check-update', (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: '{"updateAvailable":false}'
      })
    )
    await login.withPassword('genesisUser', page, {
      password: world.current.auth.genesisUserPassword
    })
    await page.raw.waitForURL((url) => url.pathname !== '/login')
    await page.goto('/settings/audit-log')
    const select = page.raw.locator('[data-test=audit-group]')
    const out = path.resolve('.tmp/select-underlines')
    fs.mkdirSync(out, { recursive: true })
    for (const [width, scheme] of [
      [1440, 'light'],
      [1440, 'dark'],
      [390, 'dark']
    ]) {
      await page.raw.setViewportSize({ width, height: 900 })
      await page.raw.emulateMedia({ colorScheme: scheme })
      await page.raw.evaluate(
        (dark) => document.documentElement.classList.toggle('dark', dark),
        scheme === 'dark'
      )
      const style = await select.evaluate((el) => {
        const css = getComputedStyle(el),
          box = el.getBoundingClientRect()
        return {
          top: css.borderTopWidth,
          right: css.borderRightWidth,
          left: css.borderLeftWidth,
          bottom: css.borderBottomWidth,
          line: css.borderBottomStyle,
          radius: css.borderRadius,
          inside: box.left >= 0 && box.right <= innerWidth
        }
      })
      expect(style).toMatchObject({
        top: '0px',
        right: '0px',
        left: '0px',
        bottom: '1px',
        line: 'dashed',
        radius: '0px',
        inside: true
      })
      await select.focus()
      await select.press('Space')
      await expect(select).toHaveAttribute('aria-expanded', 'true')
      await page.raw
        .getByRole('option', { name: 'All events', exact: true })
        .waitFor()
      await page.screenshot(path.join(out, `audit-${width}-${scheme}.png`))
      await select.press('Escape')
      await expect(select).toBeFocused()
    }
    await select.press('Space')
    await select.press('End')
    await select.press('Enter')
    await expect(select).toContainText('Helm')
    expect(page).toHaveNoSmoke()
  }
)
