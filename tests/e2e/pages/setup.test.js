const { test } = require('sounding')

test(
  'setup can be completed through the real browser',
  { browser: true },
  async ({ page, expect }) => {
    await page.goto('/setup')

    await page
      .getByPlaceholder(/enter your email address/i)
      .fill('founder@example.com')
    await page.getByPlaceholder(/create a password/i).fill('secret123!')
    await page.getByPlaceholder(/confirm password/i).fill('secret123!')
    await page.getByRole('button', { name: /create account/i }).click()

    await page.waitForURL(/\/$/)

    expect(await page.title()).toMatch(/Slipway/i)
    expect(
      await page
        .getByText(/get started by creating your first project/i)
        .isVisible()
    ).toBe(true)
  }
)
