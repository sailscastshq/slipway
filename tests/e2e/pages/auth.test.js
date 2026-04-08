const { test } = require('sounding')

test(
  'genesis user can log in through the real browser and open the new project page',
  { browser: true },
  async ({ sails, login, page, expect }) => {
    const current = await sails.sounding.world.use('configured-slipway')

    await login.withPassword(current.users.genesisUser, page, {
      password: current.auth.genesisUserPassword
    })

    await page.waitForURL(/\/$/)

    expect(
      await page
        .getByText(/get started by creating your first project/i)
        .isVisible()
    ).toBe(true)

    await page.goto('/projects/new')
    await page.waitForURL(/\/projects\/new$/)

    expect(await page.title()).toMatch(/Create Project.*Slipway/i)
    expect(await page.getByPlaceholder(/project name/i).isVisible()).toBe(true)
    expect(
      await page
        .getByPlaceholder(/a brief description about your project/i)
        .isVisible()
    ).toBe(true)
  }
)
