const { test } = require('sounding')

test(
  'settings validate inline in light and dark mode before saving',
  { browser: true, world: 'configured-slipway' },
  async ({ world, login, page, expect }) => {
    const current = world.current

    await page.resize(1440, 1000)
    await page.raw.emulateMedia({ colorScheme: 'light' })
    await login.withPassword('genesisUser', page, {
      password: current.auth.genesisUserPassword
    })

    await page.goto('/settings/instance')
    await page.fill('#instanceDomain', 'example.com/admin')
    await page.raw.locator('#instanceDomain').blur()
    await page.raw
      .locator('#instance-domain-error')
      .waitFor({ state: 'visible' })
    await expect(page).toSee('Enter a valid domain without a path')
    await page.screenshot('.tmp/issue-207-instance-validation-light.png', {
      fullPage: true
    })

    await page.fill('#instanceDomain', 'slipway.example.com')
    await page.raw
      .locator('#instance-domain-error')
      .waitFor({ state: 'hidden' })

    await page.raw.emulateMedia({
      colorScheme: 'dark',
      reducedMotion: 'reduce'
    })
    await page.goto('/settings/notifications')
    const webhookEnabled = page.raw.locator('[data-test="webhook-enabled"]')
    expect(await webhookEnabled.getAttribute('type')).toBe('checkbox')
    expect(await webhookEnabled.getAttribute('role')).toBe('switch')
    expect(await webhookEnabled.getAttribute('aria-label')).toBe(
      'Webhook notifications'
    )
    expect(
      await webhookEnabled.evaluate(
        (element) => getComputedStyle(element).transitionDuration
      )
    ).toBe('0.1s')
    if (!(await webhookEnabled.isChecked())) {
      await webhookEnabled.focus()
      await page.raw.keyboard.press('Space')
    }
    expect(await webhookEnabled.isChecked()).toBe(true)
    await page.fill(
      '#webhookUrl',
      'https://operator:private-token@example.com/hook'
    )
    await page.raw.locator('#webhookUrl').blur()
    await page.raw.locator('#webhook-url-error').waitFor({ state: 'visible' })
    await expect(page).toSee(
      'Enter a valid HTTP or HTTPS webhook URL without credentials'
    )
    await page.screenshot('.tmp/issue-207-notification-validation-dark.png', {
      fullPage: true
    })

    await page.fill('#webhookUrl', 'https://events.example.com/slipway')
    await page.raw.locator('#webhook-url-error').waitFor({ state: 'hidden' })
    const saved = page.raw.waitForResponse(
      (response) =>
        response.url().endsWith('/settings/notifications') &&
        response.request().method() === 'PATCH'
    )
    await page.raw.getByRole('button', { name: 'Save changes' }).click()
    expect((await saved).status()).toBe(409)

    expect(page).toHaveNoJavascriptErrors()
  }
)
