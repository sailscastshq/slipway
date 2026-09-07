const fs = require('node:fs')
const path = require('node:path')
const { test } = require('sounding')

test(
  'long deployment toast stays inside its viewport with visible icon and dismiss button',
  {
    browser: true,
    world: {
      name: 'configured-slipway',
      context: {
        deploymentTarget: { slug: 'toast-overflow', name: 'depth' }
      }
    }
  },
  async ({ sails, world, login, page, expect }) => {
    const current = world.current
    await sails.models.app.updateOne({ id: current.apps.web.id }).set({
      name: 'depth.sailscasts.com'
    })
    await world.create('deployment').with({
      status: 'building',
      triggerType: 'manual',
      environment: current.environments.production.id,
      app: current.apps.web.id,
      triggeredBy: current.users.genesisUser.id,
      gitBranch: 'main',
      startedAt: Date.now() - 28000
    })
    await login.withPassword('genesisUser', page, {
      password: current.auth.genesisUserPassword
    })
    const root = path.resolve('.github/screenshots/toast-overflow')
    fs.mkdirSync(root, { recursive: true })
    for (const [width, mode] of [
      [1440, 'dark'],
      [390, 'dark'],
      [390, 'light']
    ]) {
      await page.raw.setViewportSize({ width, height: 900 })
      await page.raw.emulateMedia({ colorScheme: mode })
      const viewport = page.raw.locator('[data-slot="toast-viewport"]')
      const toast = viewport.locator('[data-slot="toast"]', {
        hasText: 'depth.sailscasts.com'
      })
      await expect(toast).toBeVisible()
      await page.raw
        .locator('[data-klean-toast-item][data-state="open"]')
        .waitFor()
      const bounds = await toast.evaluate((element) => {
        const box = element.getBoundingClientRect()
        const viewport = element.closest('[data-slot="toast-viewport"]')
        const parent = viewport.getBoundingClientRect()
        return {
          inside:
            box.left >= parent.left - 1 &&
            box.right <= parent.right + 1 &&
            box.right <= window.innerWidth,
          noOverflow: viewport.scrollWidth <= viewport.clientWidth + 1,
          width: box.width
        }
      })
      expect(bounds.inside).toBe(true)
      expect(bounds.noOverflow).toBe(true)
      expect(bounds.width <= 320).toBe(true)
      const dismiss = toast.getByRole('button', {
        name: /Dismiss building deployment/
      })
      for (const control of [dismiss, toast.locator('[data-slot="spinner"]')]) {
        const box = await control.boundingBox()
        const outer = await toast.boundingBox()
        expect(
          box.x >= outer.x && box.x + box.width <= outer.x + outer.width
        ).toBe(true)
      }
      await page.screenshot(path.join(root, `deployment-${width}-${mode}.png`))
      await toast.screenshot({
        path: path.join(root, `toast-${width}-${mode}.png`)
      })
    }
    await page.raw
      .getByRole('button', { name: /Dismiss building deployment/ })
      .click()
    await expect(page.raw.locator('[data-slot="toast"]')).toHaveCount(0)
    expect(page).toHaveNoSmoke()
  }
)
