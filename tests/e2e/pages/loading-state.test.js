const { test } = require('sounding')

test(
  'Klean Loading State names a busy Bosun region and keeps Slippy decorative',
  { browser: true, world: 'configured-slipway' },
  async ({ world, login, page, expect }) => {
    let releaseDiff
    let announceDiffRequest
    const diffRequested = new Promise((resolve) => {
      announceDiffRequest = resolve
    })
    const diffReleased = new Promise((resolve) => {
      releaseDiff = resolve
    })

    await page.raw.route('**/api/v1/system/check-update', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ updateAvailable: false })
      })
    })
    await page.raw.route('**/api/v1/bosun/diff?**', async (route) => {
      announceDiffRequest()
      await diffReleased
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          modelCount: 1,
          hasPendingChanges: false,
          statements: []
        })
      })
    })

    await login.withPassword('genesisUser', page, {
      password: world.current.auth.genesisUserPassword
    })
    await page.resize(1440, 900)
    await page.goto('/bosun')
    await page.raw.getByRole('tab', { name: 'Migrate' }).click()
    await diffRequested

    const region = page.raw.getByRole('tabpanel', { name: 'Migrate' })
    await expect(region).toHaveAttribute('aria-busy', 'true')
    const status = region.getByRole('status')
    await expect(status).toHaveAttribute('data-slot', 'loading-state')
    await expect(status).toHaveText('Loading migration diff…')
    await expect(status.locator('[data-slot="spinner"]')).toBeVisible()
    await expect(status.locator('.slippy-loader')).toHaveAttribute(
      'aria-hidden',
      'true'
    )

    releaseDiff()
    await expect(status).not.toBeVisible()
    await expect(region).not.toHaveAttribute('aria-busy', 'true')
    await expect(region.getByText('No pending schema changes')).toBeVisible()

    expect(page).toHaveNoSmoke()
  }
)
