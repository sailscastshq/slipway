const { test } = require('sounding')

test(
  'Klean Tooltip is visible to pointer and keyboard users without stealing focus',
  {
    browser: true,
    world: 'configured-slipway'
  },
  async ({ page, expect, world }) => {
    await page.raw.route('**/api/v1/system/check-update', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ updateAvailable: false })
      })
    })

    await page.goto('/login')
    const csrf = await page.raw.evaluate(
      () => window.__SLIPWAY_CSRF_TOKEN__ || ''
    )
    const loginResponse = await page.raw.request.post('/login', {
      headers: { 'x-csrf-token': csrf },
      form: {
        email: world.current.users.genesisUser.email,
        password: world.current.auth.genesisUserPassword
      }
    })
    if (!loginResponse.ok()) {
      throw new Error(
        `Browser session setup failed (${loginResponse.status()}): ${await loginResponse.text()}`
      )
    }
    await page.goto('/bosun')

    const trigger = page.raw.locator('[data-test="bosun-version"]')
    await trigger.focus()

    const tooltip = page.raw.getByRole('tooltip', {
      name: 'Slipway version'
    })
    await tooltip.waitFor({ state: 'visible' })

    expect(await trigger.getAttribute('aria-describedby')).toBe(
      await tooltip.getAttribute('id')
    )
    expect(
      await page.raw.evaluate(() => document.activeElement?.dataset.test)
    ).toBe('bosun-version')

    await page.key('Escape')
    await tooltip.waitFor({ state: 'hidden' })
    expect(
      await page.raw.evaluate(() => document.activeElement?.dataset.test)
    ).toBe('bosun-version')

    await trigger.hover()
    await tooltip.waitFor({ state: 'visible' })

    expect(page).toHaveNoJavascriptErrors()
  }
)
