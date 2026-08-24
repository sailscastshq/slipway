const { test } = require('sounding')

test(
  'service commands use durable Klean Row Actions without hiding app behavior',
  {
    browser: true,
    world: {
      name: 'configured-slipway',
      context: {
        deploymentTarget: {
          slug: 'klean-row-actions',
          name: 'Klean Row Actions'
        }
      }
    }
  },
  async ({ world, login, page, expect }) => {
    const current = world.current
    const service = await world.create('service').with({
      name: 'primary-db',
      type: 'postgresql',
      version: '17',
      status: 'running',
      environment: current.environments.production.id,
      internalHost: 'primary-db',
      internalPort: 5432,
      database: 'app',
      username: 'slipway',
      password: 'secret'
    })

    await page.raw.route('**/api/v1/system/check-update', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ updateAvailable: false })
      })
    })

    await login.withPassword('genesisUser', page, {
      password: current.auth.genesisUserPassword
    })
    await page.raw.addInitScript(() => {
      window.EventSource = class MockEventSource {
        constructor() {
          setTimeout(() => this.onopen?.(), 0)
        }

        close() {}
      }
    })
    await page.resize(1440, 900)
    await page.goto(
      `/projects/${current.projects.deploymentTarget.slug}/environments/${current.environments.production.slug}/services/${service.id}`
    )

    const actions = page.raw.locator('[data-test="service-row-actions"]')
    const trigger = actions.getByRole('button', {
      name: 'Actions for primary-db'
    })

    await expect(actions).toHaveAttribute('data-slot', 'row-actions')
    await expect(actions).toHaveAttribute('role', 'group')
    await expect(trigger).toHaveAttribute('aria-expanded', 'false')

    await trigger.focus()
    await page.key('Enter')
    await expect(trigger).toHaveAttribute('aria-expanded', 'true')
    await expect(page.raw.getByRole('menu')).toBeVisible()
    await expect(page.raw.getByRole('menuitem', { name: 'Stop' })).toBeFocused()
    await expect(
      page.raw.getByRole('menuitem', { name: 'Settings' })
    ).toHaveAttribute(
      'href',
      `/projects/${current.projects.deploymentTarget.slug}/environments/${current.environments.production.slug}/services/${service.id}/settings`
    )

    await page.key('End')
    await expect(
      page.raw.getByRole('menuitem', { name: 'Clear logs' })
    ).toBeFocused()
    await page.key('Escape')
    await expect(page.raw.getByRole('menu')).toBeHidden()
    await expect(trigger).toBeFocused()

    expect(page).toHaveNoSmoke()
  }
)
