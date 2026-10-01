const { test } = require('sounding')

test(
  'saving service settings does not report a failed restart as success',
  {
    browser: true,
    world: {
      name: 'configured-slipway',
      context: { deploymentTarget: { slug: 'service-feedback' } }
    }
  },
  async ({ world, login, page, expect }) => {
    const service = await world.create('service').with({
      environment: world.current.environments.production.id,
      name: 'Customer database',
      status: 'running',
      containerName: 'service-feedback-db',
      internalHost: 'service-feedback-db',
      internalPort: 5432,
      database: 'app',
      username: 'postgres'
    })
    await login.withPassword('genesisUser', page, {
      password: world.current.auth.genesisUserPassword
    })
    await page.raw.waitForURL('**/')
    await page.goto(
      `/projects/service-feedback/environments/production/services/${service.id}/settings`
    )
    await page.raw.route(`**/api/v1/services/${service.id}`, (route) =>
      route.request().headers().precognition
        ? route.continue()
        : route.fulfill({ status: 200, json: { success: true } })
    )
    await page.raw.route(`**/api/v1/services/${service.id}/restart`, (route) =>
      route.fulfill({
        status: 503,
        json: {
          message: 'Restart unavailable. Settings are saved; retry the restart.'
        }
      })
    )
    await page.raw.locator('#memoryLimit').fill('768m')
    await page.raw
      .getByRole('button', { name: 'Save settings and restart service' })
      .click()
    const toast = page.raw.locator(
      '[data-slot="toast"]:not([data-state="closing"])'
    )
    await expect(toast).toContainText('Restart unavailable. Settings are saved')
    await expect(toast).not.toContainText('service restarted')
    await expect(page.raw.locator('#memoryLimit')).toHaveValue('768m')
    expect(page).toHaveNoJavascriptErrors()
  }
)
