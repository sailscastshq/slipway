const { test } = require('sounding')

for (const browserProject of ['desktop', 'mobile']) {
  test(
    `genesis user can log in and open the new project page on ${browserProject}`,
    { browser: browserProject, world: 'configured-slipway' },
    async ({ world, login, page, expect }) => {
      await login.withPassword('genesisUser', page, {
        password: world.current.auth.genesisUserPassword
      })

      await page.wait('text=Get started by creating your first project')
      await expect(page).toHavePath('/')
      await expect(page).toSee('Get started by creating your first project')

      await page.goto('/projects/new')
      await page.wait('#name')

      await expect(page).toHavePath('/projects/new')
      await expect(page).toHaveTitle(/Create Project.*Slipway/i)
      expect(page).toHaveNoSmoke()
    }
  )
}
