const { test } = require('sounding')

test(
  'production error pages stay clear and responsive',
  {
    browser: true,
    world: 'configured-slipway'
  },
  async ({ sails, world, page, expect }) => {
    const previousNodeEnvironment = process.env.NODE_ENV
    const token = 'production-error-page-browser-probe'

    try {
      await page.resize(1440, 900)
      await page.raw.emulateMedia({ colorScheme: 'light' })
      await page.goto('/this-slipway-page-does-not-exist')

      await expect(page).toSee('Page not found')
      expect(await errorPageHasNoHorizontalOverflow(page, '404')).toBe(true)
      await page.screenshot('.tmp/issue-204-404-desktop-light.png', {
        fullPage: true
      })

      await page.resize(390, 844)
      await page.raw.emulateMedia({ colorScheme: 'dark' })
      expect(await errorPageHasNoHorizontalOverflow(page, '404')).toBe(true)
      await waitForDarkPrimaryAction(page)
      expect(await primaryActionColors(page)).toEqual({
        background: 'rgb(250, 250, 250)',
        text: 'rgb(10, 10, 10)'
      })
      await page.screenshot('.tmp/issue-204-404-mobile-dark.png', {
        fullPage: true
      })

      await sails.models.user
        .updateOne({ id: world.current.users.genesisUser.id })
        .set({
          emailStatus: 'change-requested',
          emailProofToken: token,
          emailProofTokenExpiresAt: Date.now() + 60 * 1000
        })

      process.env.NODE_ENV = 'production'
      await page.resize(1440, 900)
      await page.raw.emulateMedia({ colorScheme: 'light' })
      await page.goto(`/verify-email?token=${token}`)

      await expect(page).toSee('Something went wrong')
      await expect(page).not.toSee('Consistency violation')
      expect(await errorPageHasNoHorizontalOverflow(page, '500')).toBe(true)
      await page.screenshot('.tmp/issue-204-500-desktop-light.png', {
        fullPage: true
      })

      await page.resize(390, 844)
      await page.raw.emulateMedia({ colorScheme: 'dark' })
      expect(await errorPageHasNoHorizontalOverflow(page, '500')).toBe(true)
      await waitForDarkPrimaryAction(page)
      expect(await primaryActionColors(page)).toEqual({
        background: 'rgb(250, 250, 250)',
        text: 'rgb(10, 10, 10)'
      })
      await page.screenshot('.tmp/issue-204-500-mobile-dark.png', {
        fullPage: true
      })

      expect(page).toHaveNoJavascriptErrors()
    } finally {
      process.env.NODE_ENV = previousNodeEnvironment
    }
  }
)

async function errorPageHasNoHorizontalOverflow(page, status) {
  return page.raw.evaluate((expectedStatus) => {
    return (
      document.body.dataset.errorPage === expectedStatus &&
      document.documentElement.scrollWidth <= window.innerWidth
    )
  }, status)
}

async function primaryActionColors(page) {
  return page.raw.locator('.primary-action').evaluate((element) => {
    const styles = window.getComputedStyle(element)

    return {
      background: styles.backgroundColor,
      text: styles.color
    }
  })
}

async function waitForDarkPrimaryAction(page) {
  await page.raw.waitForFunction(() => {
    const styles = window.getComputedStyle(
      document.querySelector('.primary-action')
    )

    return (
      styles.backgroundColor === 'rgb(250, 250, 250)' &&
      styles.color === 'rgb(10, 10, 10)'
    )
  })
}
