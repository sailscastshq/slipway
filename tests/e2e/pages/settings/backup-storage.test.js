const { test } = require('sounding')
const fs = require('node:fs/promises')
const path = require('node:path')
test(
  'backup storage test and save use toasts with readable actions on mobile and desktop',
  { browser: true, world: { name: 'configured-slipway' } },
  async ({ sails, world, login, page, expect }) => {
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
    let responseStatus = 400
    let responseBody = {
      error:
        'Object storage denied access. Grant private object read, write, and delete permissions.'
    }
    await page.raw.route('**/settings/backup-storage', (route) =>
      route.fulfill({
        status: responseStatus,
        contentType: 'application/json',
        body: JSON.stringify(responseBody)
      })
    )
    await section.getByRole('button', { name: 'Test connection' }).click()
    const toast = page.raw.locator(
      '[data-slot="toast"]:not([data-state="closing"])'
    )
    await expect(toast).toContainText('Object storage denied access')
    await expect(section.getByLabel('Endpoint URL (optional)')).toBeVisible()
    const testButton = section.getByRole('button', {
      name: 'Test connection'
    })
    await testButton.hover()
    await expect(testButton).toHaveCSS('background-color', 'rgb(245, 245, 245)')
    await expect(testButton).toHaveCSS('color', 'rgb(10, 10, 10)')
    await expect(section.locator('#backup-account')).toHaveValue(
      'slipwaybackups'
    )
    await expect(
      section.getByText('Object storage denied access', { exact: false })
    ).toHaveCount(0)
    await toast.locator('button').click()
    responseStatus = 200
    responseBody = {
      message: 'Private upload, download, and deletion verified.'
    }
    const output = path.resolve('.tmp/screenshots/650')
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
      await testButton.click()
      await expect(toast).toContainText(
        'Private upload, download, and deletion verified.'
      )
      await page.screenshot(path.join(output, `backup-storage-${width}.png`), {
        animations: 'disabled'
      })
      await toast.locator('button').click()
    }
    await page.raw.setViewportSize({ width: 1280, height: 1000 })
    await page.raw.emulateMedia({ colorScheme: 'light' })
    await section.locator('#backup-provider').click()
    await page.raw
      .getByRole('option', { name: 'S3-compatible storage', exact: true })
      .click()
    await section.locator('#backup-bucket').fill('slipway-backups')
    await section.locator('#backup-region').fill('auto')
    await section
      .locator('#backup-endpoint')
      .fill('https://account-id.r2.cloudflarestorage.com')
    await expect(
      section.getByText('Required for R2', { exact: false })
    ).toBeVisible()
    await section.locator('#backup-key').fill('fixture-access')
    await section.locator('#backup-secret').fill('fixture-secret')
    await page.raw.unroute('**/settings/backup-storage')
    const originalStorage = sails.helpers.backup.getObjectStorage
    sails.helpers.backup.getObjectStorage = () => ({
      testConnection: async () => {}
    })
    await section.getByRole('button', { name: 'Save', exact: true }).click()
    await expect(toast).toContainText(
      'Private backup storage saved and verified.'
    )
    sails.helpers.backup.getObjectStorage = originalStorage
    await expect(section.locator('#backup-key')).toHaveValue('')
    await expect(section.locator('#backup-secret')).toHaveValue('')
    await expect(
      section.getByText('Private backup storage saved and verified.', {
        exact: true
      })
    ).toHaveCount(0)
    await page.screenshot(path.join(output, 'r2-settings.png'), {
      animations: 'disabled'
    })
    await toast.locator('button').click()
    await page.raw
      .getByRole('button', { name: 'Save schedule', exact: true })
      .click()
    await expect(toast).toContainText('Backup schedule updated')
    expect(page).toHaveNoJavascriptErrors()
  }
)
