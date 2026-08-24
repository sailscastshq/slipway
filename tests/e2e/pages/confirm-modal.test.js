const { test } = require('sounding')

test(
  'confirmation dialogs use the native modal contract and return focus',
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

    const trigger = page.raw.getByRole('button', {
      name: 'Delete account',
      exact: true
    })

    await trigger.click()

    const dialog = page.raw.getByRole('dialog', {
      name: 'Delete account'
    })
    const cancel = dialog.getByRole('button', { name: 'Cancel', exact: true })

    await expect(dialog).toBeVisible()
    await expect(dialog).toHaveAttribute('data-slot', 'dialog')
    await expect(dialog).toHaveAttribute('closedby', 'any')
    await expect(dialog).not.toHaveAttribute('aria-busy', 'true')
    await expect(cancel).toBeFocused()
    await expect(
      dialog.getByLabel('Enter your password to confirm')
    ).toBeVisible()

    const labelIds = await dialog.evaluate((element) => ({
      labelledby: element.getAttribute('aria-labelledby'),
      describedby: element.getAttribute('aria-describedby'),
      title: document.getElementById(element.getAttribute('aria-labelledby'))
        ?.textContent,
      message: document.getElementById(element.getAttribute('aria-describedby'))
        ?.textContent
    }))
    expect(labelIds.labelledby === 'confirm-modal-title').toBe(false)
    expect(labelIds.title.trim()).toBe('Delete account')
    expect(labelIds.message).toContain('permanently removed')

    await page.raw.keyboard.press('Escape')
    await expect(dialog).toBeHidden()
    await expect(trigger).toBeFocused()

    await trigger.click()
    await expect(dialog).toBeVisible()
    await page.raw.mouse.click(4, 4)
    await expect(dialog).toBeHidden()
    await expect(trigger).toBeFocused()

    expect(page).toHaveNoSmoke()
  }
)

test(
  'pending service confirmation stays busy, singular, and non-dismissible',
  {
    browser: true,
    world: {
      name: 'configured-slipway',
      context: {
        deploymentTarget: {
          slug: 'klean-dialog-confirmation',
          name: 'Klean Dialog confirmation'
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
    await page.raw.addInitScript(() => {
      window.EventSource = class MockEventSource {
        constructor() {
          setTimeout(() => this.onopen?.(), 0)
        }

        close() {}
      }
    })

    let deletionRequests = 0
    let announceDeletion
    const deletionStarted = new Promise((resolve) => {
      announceDeletion = resolve
    })
    let releaseDeletion
    const deletionRelease = new Promise((resolve) => {
      releaseDeletion = resolve
    })

    await page.raw.route(`**/api/v1/services/${service.id}`, async (route) => {
      if (route.request().method() !== 'DELETE') {
        await route.continue()
        return
      }

      deletionRequests += 1
      announceDeletion()
      await deletionRelease
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ deleted: true })
      })
    })

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
      .getByRole('menuitem', { name: 'Delete', exact: true })
      .click()

    const dialog = page.raw.getByRole('dialog', { name: 'Delete service' })
    const cancel = dialog.locator('button').first()
    const confirm = dialog.locator('button').last()

    await expect(dialog).toBeVisible()
    await confirm.click()
    await deletionStarted

    expect(deletionRequests).toBe(1)
    await expect(dialog).toHaveAttribute('aria-busy', 'true')
    await expect(dialog).toHaveAttribute('closedby', 'none')
    await expect(confirm).toBeDisabled()
    await expect(cancel).toBeDisabled()
    await expect(dialog.locator('[data-slot="spinner"]')).toBeVisible()

    await page.raw.keyboard.press('Escape')
    await page.raw.mouse.click(4, 4)
    await expect(dialog).toBeVisible()
    expect(deletionRequests).toBe(1)

    releaseDeletion()
    await expect(dialog).toBeHidden()
    expect(deletionRequests).toBe(1)

    expect(page).toHaveNoSmoke()
  }
)
