const { test } = require('sounding')

test(
  'team members see their settings without instance administration controls',
  { browser: true, world: 'configured-slipway' },
  async ({ sails, world, login, page, expect }) => {
    const current = world.current
    await sails.models.user
      .updateOne({ id: current.users.genesisUser.id })
      .set({
        isGenesisUser: false,
        teamRole: 'member'
      })
    await login.withPassword('genesisUser', page, {
      password: current.auth.genesisUserPassword
    })
    await page.goto('/settings')
    await expect(
      page.raw.getByText('CLI Tokens', { exact: true })
    ).toBeVisible()
    await expect(page.raw.locator('a[href="/bosun"]')).toHaveCount(0)
    await expect(
      page.raw.locator('a[href="/settings/global-env"]')
    ).toHaveCount(0)
    await expect(page.raw.locator('a[href="/settings/instance"]')).toHaveCount(
      0
    )
    await expect(page.raw.locator('a[href="/settings/update"]')).toHaveCount(0)
    await page.screenshot('.tmp/audit-instance-member-settings.png', {
      fullPage: true
    })
    expect(page).toHaveNoJavascriptErrors()
  }
)
