const { test } = require('sounding')

test(
  'application navigation uses the durable Klean Sidebar and native mobile Sheet',
  { browser: true, world: 'configured-slipway' },
  async ({ world, login, page, expect }) => {
    await page.raw.route('**/api/v1/system/check-update', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ updateAvailable: false })
      })
    })

    await login.withPassword('genesisUser', page, {
      password: world.current.auth.genesisUserPassword
    })
    await page.resize(1440, 900)
    await page.goto('/')
    await page.raw.evaluate(() => {
      localStorage.removeItem('klean:sidebar:primary-navigation:open')
      localStorage.removeItem('slipway:sidebar-collapsed')
    })
    await page.reload()

    const sidebar = page.raw.locator('#primary-navigation')
    const desktopToggle = page.raw.locator(
      '[data-test="desktop-sidebar-toggle"]'
    )

    await expect(sidebar).toHaveAttribute('data-slot', 'sidebar')
    await expect(sidebar).toHaveAttribute('data-state', 'open')
    await expect(sidebar).toBeVisible()

    await desktopToggle.click()
    await expect(sidebar).toHaveAttribute('data-state', 'closed')
    await expect(sidebar).toHaveAttribute('aria-hidden', 'true')
    await expect(sidebar).toHaveAttribute('inert', '')
    expect(
      await page.raw.evaluate(() =>
        localStorage.getItem('klean:sidebar:primary-navigation:open')
      )
    ).toBe('false')

    await page.reload()
    await expect(sidebar).toHaveAttribute('data-state', 'closed')
    await desktopToggle.click()
    await expect(sidebar).toHaveAttribute('data-state', 'open')

    await page.resize(390, 844)
    const mobileToggle = page.raw.locator('[data-test="mobile-sidebar-toggle"]')
    const sheet = page.raw.locator('#primary-navigation-mobile')

    await mobileToggle.click()
    await expect(sheet).toBeVisible()
    await expect(sheet).toHaveAttribute('open', '')
    await expect(sheet).toHaveAttribute('data-klean-sheet', '')

    await page.key('Escape')
    await expect(sheet).toBeHidden()
    expect(
      await page.raw.evaluate(() => document.activeElement?.dataset.test)
    ).toBe('mobile-sidebar-toggle')

    await mobileToggle.click()
    await sheet.getByRole('link', { name: 'Lookout' }).click()
    await expect(sheet).toBeHidden()
    await expect(page.raw).toHaveURL(/\/lookout/)

    expect(page).toHaveNoSmoke()
  }
)
