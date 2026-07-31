const { test } = require('sounding')

test(
  'setup can be completed through the real browser',
  { browser: true },
  async ({ page, expect }) => {
    await page.goto('/setup')

    await page.fill('#email', 'not-an-email')
    await page.raw.locator('#email').blur()
    await page.raw.locator('#setup-email-error').waitFor({ state: 'visible' })
    await expect(page).toSee('Please enter a valid email address')
    await page.screenshot('.tmp/issue-205-setup-validation-light.png', {
      fullPage: true
    })

    await page.fill('#email', 'founder@example.com')
    await page.raw.locator('#setup-email-error').waitFor({ state: 'detached' })
    await page.fill('#password', 'secret123!')
    await page.fill('#confirmPassword', 'secret123!')
    await page.click('Create account')

    await page.wait('text=Get started by creating your first project')
    await expect(page).toHavePath('/')
    await expect(page).toHaveTitle(/Slipway/i)
    await expect(page).toSee('Get started by creating your first project')
    expect(page).toHaveNoJavascriptErrors()
  }
)
