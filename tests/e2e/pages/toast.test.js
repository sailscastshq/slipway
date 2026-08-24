const { test } = require('sounding')

test(
  'notifications use one pause-aware Klean Toast viewport',
  { browser: true, world: 'configured-slipway' },
  async ({ world, login, page, expect }) => {
    await page.raw.route('**/api/v1/system/check-update', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ updateAvailable: false })
      })
    })
    const updateCheck = page.raw.waitForResponse(
      (response) =>
        new URL(response.url()).pathname === '/api/v1/system/check-update'
    )

    await login.withPassword('genesisUser', page, {
      password: world.current.auth.genesisUserPassword
    })
    await page.raw.waitForURL((url) => url.pathname !== '/login')
    await updateCheck
    await page.goto('/profile')

    const inertiaPage = await page.raw.evaluate(
      () => window.history.state?.page || window.history.state
    )
    await page.raw.route('**/profile', async (route) => {
      if (route.request().method() !== 'PATCH') {
        await route.continue()
        return
      }

      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        headers: { 'X-Inertia': 'true' },
        body: JSON.stringify({ ...inertiaPage, url: '/profile' })
      })
    })

    const name = page.raw.locator('#profile-full-name')
    await name.fill(`${await name.inputValue()} Toast`)
    await page.raw
      .getByRole('button', { name: 'Save changes', exact: true })
      .first()
      .click()

    const viewport = page.raw.locator('[data-slot="toast-viewport"]')
    const notification = viewport.locator('[data-slot="toast"]', {
      hasText: 'Profile updated'
    })

    await expect(viewport).toHaveCount(1)
    await expect(viewport).toHaveAttribute('aria-live', 'polite')
    await expect(viewport).toHaveAttribute('data-position', 'bottom-right')
    await expect(viewport).toHaveAttribute('data-from', 'right')
    await expect(viewport).toHaveAttribute('data-to', 'right')
    await expect(notification).toBeVisible()

    await notification.hover()
    await page.raw.waitForTimeout(4250)
    await expect(notification).toBeVisible()

    await page.raw.mouse.move(1, 1)
    await expect(notification).toBeHidden({ timeout: 5000 })

    expect(page).toHaveNoSmoke()
  }
)

test(
  'service operations update one persistent toast and inherit paused dismissal',
  {
    browser: true,
    world: {
      name: 'configured-slipway',
      context: {
        deploymentTarget: {
          slug: 'klean-toast-service-action',
          name: 'Klean Toast service action'
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
      status: 'stopped',
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
    await page.raw.addInitScript(() => {
      window.EventSource = class MockEventSource {
        constructor() {
          setTimeout(() => this.onopen?.(), 0)
        }

        close() {}
      }
    })

    let releaseStart
    const startRelease = new Promise((resolve) => {
      releaseStart = resolve
    })
    let announceStart
    const startRequested = new Promise((resolve) => {
      announceStart = resolve
    })

    await page.raw.route(
      `**/api/v1/services/${service.id}/start`,
      async (route) => {
        announceStart()
        await startRelease
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ started: true })
        })
      }
    )

    const updateCheck = page.raw.waitForResponse(
      (response) =>
        new URL(response.url()).pathname === '/api/v1/system/check-update'
    )
    await login.withPassword('genesisUser', page, {
      password: current.auth.genesisUserPassword
    })
    await updateCheck
    await page.goto(
      `/projects/${current.projects.deploymentTarget.slug}/environments/${current.environments.production.slug}`
    )

    await page.raw.getByRole('button', { name: /Services/ }).click()
    await page.raw
      .getByRole('button', { name: 'Actions for primary-db' })
      .click()
    await page.raw
      .getByRole('menu', { name: 'Actions for primary-db' })
      .getByRole('menuitem', { name: 'Start', exact: true })
      .click()
    await startRequested

    const viewport = page.raw.locator('[data-slot="toast-viewport"]')
    const operation = viewport.locator('[data-slot="toast"]', {
      hasText: 'primary-db'
    })

    await expect(viewport).toHaveCount(1)
    await expect(operation).toHaveCount(1)
    await expect(operation).toContainText('Starting')
    await expect(operation.locator('[data-slot="spinner"]')).toBeVisible()

    releaseStart()
    await expect(operation).toContainText('Started')
    await expect(operation.locator('[data-slot="spinner"]')).toHaveCount(0)

    await operation.hover()
    await page.raw.waitForTimeout(4250)
    await expect(operation).toBeVisible()
    await page.raw.mouse.move(1, 1)
    await expect(operation).toBeHidden({ timeout: 5000 })

    expect(page).toHaveNoSmoke()
  }
)
