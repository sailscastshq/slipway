const { test } = require('sounding')

test(
  'team switching completes through the existing Inertia UI',
  { browser: true, world: 'configured-slipway' },
  async ({ world, login, page, expect }) => {
    const current = world.current
    await world.create('team').with({
      name: 'Operations',
      slug: 'operations',
      owner: current.users.genesisUser.id
    })

    await login.withPassword('genesisUser', page, {
      password: current.auth.genesisUserPassword
    })
    await page.goto('/settings/team-profile')

    await page.click('@desktop-team-selector')
    await page.raw.getByRole('button', { name: 'Operations' }).click()
    await page.raw.waitForURL((url) => url.pathname === '/')

    await expect(
      page.raw.locator('[data-test="desktop-team-name"]')
    ).toHaveText('Operations')
    await page.screenshot('.tmp/inertia-team-switch.png', {
      fullPage: true
    })
  }
)
