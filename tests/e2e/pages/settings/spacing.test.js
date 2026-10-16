const { test } = require('sounding')
const fs = require('node:fs')
const path = require('node:path')
const phase = process.env.SETTINGS_SPACING_REVIEW_PHASE || 'after'

test(
  'settings groups fit narrow and wide screens and retain keyboard controls',
  { browser: true, world: 'configured-slipway' },
  async ({ world, login, page, expect }) => {
    const root = path.resolve('.tmp/audit', phase)
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
        for (const target of [
          '',
          'instance',
          'team-profile',
          'notifications',
          'uploads'
        ]) {
          await page.goto(`/settings${target ? `/${target}` : ''}`)
          const content = page.raw.locator('.overflow-y-auto').last()
          expect(
            await content.evaluate(
              (element) => element.scrollWidth > element.clientWidth
            )
          ).toBe(false)
          if (target === 'instance') {
            const field = page.raw.getByLabel('Instance Name', { exact: true })
            await field.focus()
            await expect(field).toBeFocused()
            expect(
              await field.evaluate(
                (element) =>
                  parseFloat(getComputedStyle(element).borderBottomWidth) > 0
              )
            ).toBe(true)
            await page.raw.keyboard.press('Tab')
            await expect(
              page.raw.getByLabel('Instance Domain', { exact: true })
            ).toBeFocused()
          }
          if (!target) {
            const link = page.raw.locator('a[href="/settings/instance"]')
            await link.focus()
            await expect(link).toBeFocused()
            if (phase !== 'before') {
              expect(
                await link.evaluate(
                  (element) => getComputedStyle(element).outlineStyle
                )
              ).toBe('solid')
            }
          }
          await page.screenshot(
            path.join(root, `${target || 'index'}-${width}-${scheme}.png`),
            { fullPage: true, animations: 'disabled' }
          )
          if (target === 'notifications') {
            const toggle = page.raw.getByRole('switch', {
              name: 'Webhook notifications',
              exact: true
            })
            await toggle.focus()
            await page.raw.keyboard.press('Space')
            await expect(toggle).toBeChecked()
            await page.raw
              .locator('#webhookUrl')
              .fill('https://events.example.com/slipway')
            await page.raw.locator('#webhookUrl').focus()
            await page.raw.locator('#webhookUrl').scrollIntoViewIfNeeded()
            await page.screenshot(
              path.join(root, `notification-channel-${width}-${scheme}.png`),
              { fullPage: true, animations: 'disabled' }
            )
          }
          if (target === 'uploads') {
            const radio = page.raw.getByRole('radio').first()
            await radio.focus()
            await page.raw.keyboard.press('ArrowDown')
            await expect(page.raw.getByRole('radio').nth(1)).toBeChecked()
            await expect(
              page.raw.getByRole('heading', {
                name: 'Amazon S3 Configuration',
                exact: true
              })
            ).toBeVisible()
          }
        }
      }
    }
    expect(page).toHaveNoSmoke()
  }
)
