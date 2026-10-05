const { test } = require('sounding')
const fs = require('node:fs')
const path = require('node:path')

const phase = process.env.PROFILE_REVIEW_PHASE || 'after'
const root = path.resolve('.tmp/local-review/profile', phase)

test(
  'account Profile local review is labelled, keyboard accessible and fits both viewports',
  { browser: true, world: 'configured-slipway' },
  async ({ login, world, page, expect }) => {
    fs.mkdirSync(root, { recursive: true })
    await page.raw.route('**/api/v1/system/check-update', (route) =>
      route.fulfill({ json: { updateAvailable: false } })
    )
    await login.withPassword('genesisUser', page, {
      password: world.current.auth.genesisUserPassword
    })
    await page.raw.waitForURL('**/')
    for (const width of [1440, 390]) {
      await page.resize(width, 1000)
      for (const scheme of ['light', 'dark']) {
        await (scheme === 'light' ? page.inLightMode() : page.inDarkMode())
        await page.goto('/profile')
        await expect(page.raw.locator('#profile-full-name')).toBeVisible()
        await page.raw.locator('#profile-full-name').focus()
        await expect(page.raw.locator('#profile-full-name')).toBeFocused()
        await page.raw.keyboard.press('Tab')
        await expect(page.raw.locator('#profile-email')).toBeFocused()
        if (phase !== 'before') {
          await expect(
            page.raw.getByLabel('Full Name', { exact: true })
          ).toBeVisible()
          await expect(
            page.raw.getByLabel('Email', { exact: true })
          ).toBeVisible()
        }
        const overflow = await page.raw.evaluate(
          () => document.documentElement.scrollWidth > innerWidth
        )
        expect(overflow).toBe(false)
        await page.screenshot(path.join(root, `${width}-${scheme}.png`), {
          animations: 'disabled',
          fullPage: true
        })
      }
    }
    expect(page).toHaveNoSmoke()
  }
)
