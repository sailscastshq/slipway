const { test } = require('sounding')
const fs = require('node:fs')

test(
  'instance routing failure stays editable with a retry action',
  { browser: true, world: 'configured-slipway' },
  async ({ sails, world, login, page, expect }) => {
    const original = sails.helpers.caddy.updateDashboardRoute
    const fail = async () => {
      throw new Error('Caddy unavailable')
    }
    fail.with = fail
    sails.helpers.caddy.updateDashboardRoute = fail
    try {
      await login.withPassword('genesisUser', page, {
        password: world.current.auth.genesisUserPassword
      })
      await page.goto('/settings/instance')
      await page.raw.locator('#instanceDomain').fill('dashboard.example.com')
      const responsePromise = page.raw.waitForResponse(
        (response) =>
          response.request().method() === 'PATCH' &&
          !response.request().headers().precognition
      )
      await page.raw.getByRole('button', { name: 'Save changes' }).click()
      expect((await responsePromise).status()).toBe(303)
      await page.raw.getByRole('button', { name: 'Retry apply' }).waitFor()
      await expect(page).toSee(
        'Could not apply routing settings. Previous settings were preserved. Check Caddy and retry'
      )
      expect(
        await page.raw.getByRole('button', { name: 'Retry apply' }).isEnabled()
      ).toBe(true)
      expect(await page.raw.locator('#instanceDomain').inputValue()).toBe(
        'dashboard.example.com'
      )
      fs.mkdirSync('.github/screenshots/audit-routing-failure', {
        recursive: true
      })
      await page.screenshot(
        '.github/screenshots/audit-routing-failure/retry.png',
        { fullPage: true, animations: 'disabled' }
      )
    } finally {
      sails.helpers.caddy.updateDashboardRoute = original
    }
  }
)
