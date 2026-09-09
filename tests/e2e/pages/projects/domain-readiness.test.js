const { test } = require('sounding')
const fs = require('node:fs')
const path = require('node:path')

test(
  'environment domain dialog keeps two actions and explains unverified TLS on errors',
  {
    browser: true,
    world: {
      name: 'configured-slipway',
      context: { deploymentTarget: { slug: 'domain-readiness' } }
    }
  },
  async ({ world, login, page, expect }) => {
    const { projects, apps, auth } = world.current
    await login.withPassword('genesisUser', page, {
      password: auth.genesisUserPassword
    })
    await page.goto(
      `/projects/${projects.deploymentTarget.slug}/environments/production/apps/${apps.web.slug}`
    )
    const root = path.resolve('output/issue-374')
    fs.mkdirSync(root, { recursive: true })
    for (const [width, dark] of [
      [1280, false],
      [390, true]
    ]) {
      await page.raw.setViewportSize({ width, height: 850 })
      await page.raw.emulateMedia({ colorScheme: dark ? 'dark' : 'light' })
      await page.raw.getByRole('button', { name: 'Open app actions' }).click()
      await page.raw
        .getByRole('menuitem', { name: 'Custom domain', exact: true })
        .click()
      const dialog = page.raw.getByRole('dialog', {
        name: 'Environment domain'
      })
      await expect(dialog).toBeVisible()
      expect(await dialog.getByRole('button').count()).toBe(2)
      await expect(dialog).toContainText('Not verified')
      await expect(dialog.locator('[data-slot="alert"]')).toHaveCount(1)
      const input = dialog.getByRole('textbox', { name: 'Hostname' })
      expect(
        await input.evaluate((el) => getComputedStyle(el).borderBottomStyle)
      ).toBe('dashed')
      await input.fill('app.example.com')
      await page.raw.route(
        '**/api/v1/projects/domain-readiness/environments/production',
        (route) =>
          route.fulfill({
            status: 503,
            contentType: 'application/json',
            body: JSON.stringify({
              message:
                'The proxy could not apply this change. Previous settings were preserved. Check the proxy and retry.'
            })
          })
      )
      await dialog.getByRole('button', { name: 'Save', exact: true }).click()
      await expect(dialog.getByRole('alert')).toContainText(
        'Previous settings were preserved'
      )
      expect(await input.inputValue()).toBe('app.example.com')
      expect(await dialog.getByRole('button').count()).toBe(2)
      const box = await dialog.boundingBox()
      expect(box.x >= 0 && box.x + box.width <= width).toBe(true)
      await page.screenshot(path.join(root, `domain-${width}.png`), {
        animations: 'disabled'
      })
      await dialog.getByRole('button', { name: 'Cancel' }).click()
      await page.raw.unroute(
        '**/api/v1/projects/domain-readiness/environments/production'
      )
    }
  }
)
