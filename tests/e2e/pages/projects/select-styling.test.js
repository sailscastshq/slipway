const path = require('node:path')
const { test } = require('sounding')

test(
  'compact database select renders as text and one caret without chrome',
  {
    browser: true,
    world: {
      name: 'configured-slipway',
      context: {
        deploymentTarget: {
          slug: 'compact-database-select',
          name: 'Compact Database Select'
        }
      }
    }
  },
  async ({ world, login, page, expect }) => {
    const current = world.current
    const serviceDefaults = {
      type: 'postgresql',
      version: '17',
      status: 'running',
      environment: current.environments.production.id,
      internalPort: 5432,
      database: 'app',
      username: 'slipway',
      password: 'secret'
    }
    const database = await world.create('service').with({
      ...serviceDefaults,
      name: 'db',
      internalHost: 'db'
    })
    await world.create('service').with({
      ...serviceDefaults,
      name: 'analytics-db',
      internalHost: 'analytics-db'
    })

    await page.raw.route('**/api/v1/system/check-update', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ updateAvailable: false })
      })
    })
    await page.raw.route('**/dock/tables?**', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ tables: [] })
      })
    })

    await login.withPassword('genesisUser', page, {
      password: current.auth.genesisUserPassword
    })
    await page.resize(1440, 900)
    await page.inLightMode()
    await page.goto(
      `/projects/${current.projects.deploymentTarget.slug}/environments/production/dock/${database.id}`
    )

    const selector = page.raw.locator('[data-test="dock-database-selector"]')
    const trigger = selector.locator('[data-slot="select-trigger"]')
    await selector.waitFor()
    await selector.screenshot({
      path: path.resolve('.tmp/issue-509-select-after.png')
    })

    const chrome = await trigger.evaluate((element) => {
      const style = getComputedStyle(element)
      return {
        borderTopWidth: style.borderTopWidth,
        borderRightWidth: style.borderRightWidth,
        borderBottomWidth: style.borderBottomWidth,
        borderLeftWidth: style.borderLeftWidth,
        borderRadius: style.borderRadius,
        hasVisibleShadow: style.boxShadow.includes('0.1)')
      }
    })

    expect(chrome).toMatchObject({
      borderTopWidth: '0px',
      borderRightWidth: '0px',
      borderBottomWidth: '0px',
      borderLeftWidth: '0px',
      borderRadius: '0px',
      hasVisibleShadow: false
    })
    expect(
      await selector.locator('svg').filter({ visible: true }).count()
    ).toBe(1)

    await trigger.press('Space')
    expect(await trigger.getAttribute('aria-expanded')).toBe('true')
    await trigger.press('Escape')
    expect(await trigger.getAttribute('aria-expanded')).toBe('false')
    expect(page).toHaveNoSmoke()
  }
)
