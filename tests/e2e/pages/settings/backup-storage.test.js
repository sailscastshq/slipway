const { test } = require('sounding')
const fs = require('node:fs/promises')
const path = require('node:path')
test(
  'private backup settings use dashed Klean fields and two actions on mobile and desktop',
  { browser: true, world: { name: 'configured-slipway' } },
  async ({ world, login, page, expect }) => {
    await login.withPassword('genesisUser', page, {
      password: world.current.auth.genesisUserPassword
    })
    await page.raw.waitForURL('**/')
    await page.goto('/settings/uploads')
    const section = page.raw.locator('[data-test="backup-storage-settings"]')
    await section.locator('#backup-provider').click()
    await page.raw
      .getByRole('option', { name: 'Azure Blob Storage', exact: true })
      .click()
    await expect(section.locator('#backup-account')).toBeVisible()
    await expect(section.locator('#backup-sas')).toBeVisible()
    await expect(section.locator('#backup-key')).toHaveCount(0)
    await expect(section.getByRole('button')).toHaveCount(2)
    await section.locator('#backup-account').fill('slipwaybackups')
    await section.locator('#backup-bucket').fill('private-backups')
    await page.raw.route('**/settings/backup-storage', (route) =>
      route.fulfill({
        status: 400,
        contentType: 'application/json',
        body: JSON.stringify({
          error:
            'Object storage denied access. Grant private object read, write, and delete permissions.'
        })
      })
    )
    await section.getByRole('button', { name: 'Test connection' }).click()
    await expect(section.getByRole('alert')).toHaveAttribute(
      'data-slot',
      'alert'
    )
    await expect(section.locator('#backup-account')).toHaveValue(
      'slipwaybackups'
    )
    const output = path.resolve('output/issue-379')
    await fs.mkdir(output, { recursive: true })
    for (const [width, colorScheme] of [
      [1280, 'light'],
      [390, 'dark']
    ]) {
      await page.raw.setViewportSize({ width, height: 1000 })
      await page.raw.emulateMedia({ colorScheme })
      await section.getByRole('heading').scrollIntoViewIfNeeded()
      expect(
        await section
          .locator('#backup-account')
          .evaluate((el) => getComputedStyle(el).borderBottomStyle)
      ).toBe('dashed')
      expect(
        await section
          .locator('#backup-provider')
          .evaluate((el) => getComputedStyle(el).borderBottomStyle)
      ).toBe('dashed')
      expect(
        await page.raw.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth
        )
      ).toBe(true)
      await page.screenshot(path.join(output, `backup-storage-${width}.png`), {
        animations: 'disabled'
      })
    }
    expect(page).toHaveNoJavascriptErrors()
  }
)
