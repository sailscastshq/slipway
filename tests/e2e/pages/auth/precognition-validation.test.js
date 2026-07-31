const { test } = require('sounding')

test(
  'auth and account forms validate quietly against the server',
  { browser: true, world: 'configured-slipway' },
  async ({ sails, world, login, page, expect }) => {
    const current = world.current
    const resetToken = 'browser-precognition-reset-token'

    await page.resize(1440, 900)
    await page.raw.emulateMedia({ colorScheme: 'light' })
    await page.goto('/login')
    await showEmailValidation(page, '#email', '#login-email-error')
    await page.screenshot('.tmp/issue-205-login-validation-light.png', {
      fullPage: true
    })

    await page.goto('/forgot-password')
    await showEmailValidation(page, '#email', '#forgot-password-email-error')
    await page.screenshot(
      '.tmp/issue-205-forgot-password-validation-light.png',
      { fullPage: true }
    )

    await sails.models.user
      .updateOne({ id: current.users.genesisUser.id })
      .set({
        passwordResetToken: resetToken,
        passwordResetTokenExpiresAt: Date.now() + 60_000
      })

    await page.raw.emulateMedia({ colorScheme: 'dark' })
    await page.goto(`/reset-password?token=${resetToken}`)
    await page.fill('#password', 'short!')
    await page.raw.locator('#password').blur()
    await page.raw
      .locator('#reset-password-error')
      .waitFor({ state: 'visible' })
    await expect(page).toSee('Password must be at least 8 characters')
    await page.screenshot('.tmp/issue-205-reset-validation-dark.png', {
      fullPage: true
    })

    await page.raw.emulateMedia({ colorScheme: 'light' })
    await login.withPassword('genesisUser', page, {
      password: current.auth.genesisUserPassword
    })
    await page.goto('/profile')
    await page.fill('#profile-email', 'not-an-email')
    await page.raw.locator('#profile-email').blur()
    await page.raw.locator('#profile-email-error').waitFor({ state: 'visible' })
    await expect(page).toSee('Please enter a valid email address')
    await page.screenshot('.tmp/issue-205-profile-validation-light.png', {
      fullPage: true
    })

    expect(page).toHaveNoJavascriptErrors()
  }
)

async function showEmailValidation(page, input, error) {
  await page.fill(input, 'not-an-email')
  await page.raw.locator(input).blur()
  await page.raw.locator(error).waitFor({ state: 'visible' })
}
