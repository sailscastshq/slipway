const { test } = require('sounding')
const fs = require('node:fs/promises')
const path = require('node:path')
const custom = require('../../../../api/lib/custom-service')
test(
  'custom image creation uses a two-action Klean review and preserves mobile layout',
  {
    browser: true,
    world: {
      name: 'configured-slipway',
      context: { deploymentTarget: { slug: 'custom-ui' } }
    }
  },
  async ({ sails, world, login, page, expect }) => {
    const originalInspect = custom.inspectImage,
      originalStart = custom.start
    custom.inspectImage = async () => ({
      Id: 'sha256:' + 'b'.repeat(64),
      Config: { ExposedPorts: { '8080/tcp': {} }, Volumes: { '/data': {} } }
    })
    custom.start = async (service) => {
      await sails.models.service
        .updateOne({ id: service.id })
        .set({ status: 'stopped' })
    }
    try {
      await login.withPassword('genesisUser', page, {
        password: world.current.auth.genesisUserPassword
      })
      await page.raw.waitForURL('**/')
      await page.goto('/projects/custom-ui/environments/production?services')
      await page.raw
        .getByRole('button', { name: '+ Add service', exact: true })
        .click()
      await page.raw.getByRole('combobox', { name: 'Service type' }).click()
      await page.raw
        .getByRole('option', { name: 'Custom image', exact: true })
        .click()
      const form = page.raw.locator('[data-test="custom-service-form"]')
      await form
        .getByLabel('Image', { exact: true })
        .fill('example/private-search:1.4')
      await expect(
        form.getByLabel('Service name', { exact: true })
      ).toHaveValue('private-search')
      await expect(form.getByRole('button')).toHaveCount(2)
      const output = path.resolve('output/issue-375')
      await fs.mkdir(output, { recursive: true })
      for (const [width, colorScheme] of [
        [1280, 'light'],
        [390, 'dark']
      ]) {
        await page.raw.setViewportSize({ width, height: 1000 })
        await page.raw.emulateMedia({ colorScheme })
        await form.scrollIntoViewIfNeeded()
        expect(
          await form
            .getByLabel('Image', { exact: true })
            .evaluate((el) => getComputedStyle(el).borderBottomStyle)
        ).toBe('dashed')
        expect(
          await page.raw.evaluate(
            () => document.documentElement.scrollWidth <= innerWidth
          )
        ).toBe(true)
        await page.screenshot(path.join(output, `custom-form-${width}.png`), {
          animations: 'disabled'
        })
      }
      await form.getByRole('button', { name: 'Review', exact: true }).click()
      await expect(
        form.locator('[data-test="custom-service-review"]')
      ).toBeVisible()
      await expect(form.getByRole('button')).toHaveCount(2)
      await expect(form).toContainText('Unverified — no health check')
      expect(
        await page.raw.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth
        )
      ).toBe(true)
      await page.screenshot(path.join(output, 'custom-review-390.png'), {
        animations: 'disabled'
      })
      await form.getByRole('button', { name: 'Create', exact: true }).click()
      await page.raw
        .getByRole('link', { name: 'private-search', exact: true })
        .click()
      const panel = page.raw.locator('[data-test="custom-service-status"]')
      await expect(panel).toContainText('Custom image')
      await expect(panel).toContainText('Health: Unverified')
      await expect(panel.getByRole('button')).toHaveCount(2)
      await expect(
        page.raw.getByRole('button', { name: 'Restore backup', exact: true })
      ).toHaveCount(0)
      await panel
        .getByRole('button', { name: 'Connect apps', exact: true })
        .click()
      await expect(panel.getByRole('button')).toHaveCount(2)
      await panel.getByRole('button', { name: 'Cancel', exact: true }).click()
      await page.screenshot(path.join(output, 'custom-service-390.png'), {
        animations: 'disabled'
      })
      expect(page).toHaveNoJavascriptErrors()
    } finally {
      custom.inspectImage = originalInspect
      custom.start = originalStart
    }
  }
)
