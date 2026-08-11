const { test } = require('sounding')

test(
  'Klean Tooltip is visible to pointer and keyboard users without stealing focus',
  {
    browser: true,
    world: 'configured-slipway'
  },
  async ({ login, page, expect, world }) => {
    await page.raw.route('**/api/v1/system/check-update', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ updateAvailable: false })
      })
    })

    await login.withPassword('genesisUser', page, {
      password: world.current.auth.genesisUserPassword
    })
    await page.goto('/bosun')
    await page.resize(1280, 800)
    await page.inLightMode()

    const trigger = page.raw.locator('[data-test="bosun-version"]')
    await trigger.focus()

    const tooltip = page.raw.getByRole('tooltip', {
      name: 'Slipway version'
    })
    await tooltip.waitFor({ state: 'visible' })

    expect(await trigger.getAttribute('aria-describedby')).toBe(
      await tooltip.getAttribute('id')
    )
    expect(await tooltip.getAttribute('data-placement')).toMatch(/^bottom/)
    expect(
      await page.raw.evaluate(() => document.activeElement?.dataset.test)
    ).toBe('bosun-version')

    await page.screenshot('.tmp/issue-341-tooltip-focus-light.png')

    await page.key('Escape')
    await tooltip.waitFor({ state: 'hidden' })
    expect(
      await page.raw.evaluate(() => document.activeElement?.dataset.test)
    ).toBe('bosun-version')

    await trigger.hover()
    await tooltip.waitFor({ state: 'visible' })
    await page.inDarkMode()
    await page.screenshot('.tmp/issue-341-tooltip-hover-dark.png')

    expect(page).toHaveNoJavascriptErrors()
  }
)
