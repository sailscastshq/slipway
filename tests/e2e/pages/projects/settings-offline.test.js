const { test } = require('sounding')
const fs = require('node:fs')

test(
  'offline environment saves retain edits and support an explicit retry',
  {
    browser: true,
    world: {
      name: 'configured-slipway',
      context: { deploymentTarget: { slug: 'offline-settings' } }
    }
  },
  async ({ sails, world, login, page, expect }) => {
    const current = world.current
    await login.withPassword('genesisUser', page, {
      password: current.auth.genesisUserPassword
    })
    const url = `/api/v1/projects/offline-settings/environments/${current.environments.production.slug}`
    await page.goto(
      `/projects/offline-settings/environments/${current.environments.production.slug}/settings`
    )
    await page.raw.locator('#name').fill('Edited while offline')
    await page.raw.route(`**${url}`, async (route) => {
      if (
        route.request().method() === 'PATCH' &&
        !route.request().headers().precognition
      )
        await route.abort('internetdisconnected')
      else await route.continue()
    })
    await page.raw.getByRole('button', { name: 'Save changes' }).click()
    await page.raw.locator('[data-test="environment-save-error"]').waitFor()
    expect(await page.raw.locator('#name').inputValue()).toBe(
      'Edited while offline'
    )
    expect(
      await page.raw.getByRole('button', { name: 'Retry save' }).isEnabled()
    ).toBe(true)
    fs.mkdirSync('.github/screenshots/audit-settings-offline', {
      recursive: true
    })
    await page.screenshot(
      '.github/screenshots/audit-settings-offline/retry.png',
      { fullPage: true, animations: 'disabled' }
    )
    await page.raw.unroute(`**${url}`)
    await page.raw.getByRole('button', { name: 'Retry save' }).click()
    await page.raw.getByText('Environment updated', { exact: true }).waitFor()
    expect(
      (
        await sails.models.environment.findOne({
          id: current.environments.production.id
        })
      ).name
    ).toBe('Edited while offline')
  }
)
