const { test } = require('sounding')

test(
  'setup can be completed through the real browser',
  { browser: true },
  async ({ page, expect }) => {
    await page.goto('/setup')

    await page.fill('#email', 'founder@example.com')
    await page.fill('#password', 'secret123!')
    await page.fill('#confirmPassword', 'secret123!')
    await page.click('Create account')

    await page.wait('text=Get started by creating your first project')
    await expect(page).toHavePath('/')
    await expect(page).toHaveTitle(/Slipway/i)
    await expect(page).toSee('Get started by creating your first project')
    expect(page).toHaveNoSmoke()
  }
)
