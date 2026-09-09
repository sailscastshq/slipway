const { test } = require('sounding')
const assert = require('node:assert/strict')
const fs = require('node:fs/promises')
const path = require('node:path')
const custom = require('../../../../api/lib/custom-service')
test(
  'custom update reviews preserve Klean fields, two actions, secret redaction and mobile layout',
  {
    browser: true,
    world: {
      name: 'configured-slipway',
      context: { deploymentTarget: { slug: 'update-ui' } }
    }
  },
  async ({ sails, world, login, page, expect }) => {
    const definition = custom.validate({
      image: 'search:1.4',
      name: 'search',
      port: 8080,
      env: { TOKEN: 'never-render-this' },
      healthCommand: ['wget', 'http://localhost:8080']
    })
    const service = await world.create('service').with({
      type: 'custom',
      name: 'Search',
      version: definition.image,
      status: 'running',
      containerId: 'ui-original',
      containerName: 'slipway-update-ui',
      imageReference: 'sha256:' + 'a'.repeat(64),
      customDefinition: definition,
      environment: world.current.environments.production.id,
      customState: {
        image: definition.image,
        volumes: [],
        appIds: [],
        health: 'healthy'
      }
    })
    const originalImage = custom.inspectImage,
      originalInspect = custom.inspectContainer
    custom.inspectImage = async () => ({
      Id: 'sha256:' + 'b'.repeat(64),
      Config: {}
    })
    custom.inspectContainer = async () => ({
      Id: 'ui-original',
      State: { Running: true },
      Mounts: []
    })
    try {
      await login.withPassword('genesisUser', page, {
        password: world.current.auth.genesisUserPassword
      })
      await page.goto(
        `/projects/update-ui/environments/production/services/${service.id}`
      )
      const panel = page.raw.locator('[data-test="custom-service-update"]')
      await page.raw.getByRole('button', { name: 'Logs', exact: true }).click()
      await panel
        .getByRole('button', { name: 'Update image', exact: true })
        .click()
      await panel.getByLabel('Image', { exact: true }).fill('search:1.5')
      const output = path.resolve('output/issue-528')
      await fs.mkdir(output, { recursive: true })
      for (const [width, colorScheme] of [
        [1280, 'light'],
        [390, 'dark']
      ]) {
        await page.raw.setViewportSize({ width, height: 1000 })
        await page.raw.emulateMedia({ colorScheme })
        await panel.scrollIntoViewIfNeeded()
        await expect(panel.getByRole('button')).toHaveCount(2)
        assert.equal(
          await panel
            .getByLabel('Image', { exact: true })
            .evaluate((el) => getComputedStyle(el).borderBottomStyle),
          'dashed'
        )
        assert.equal(
          await page.raw.evaluate(
            () => document.documentElement.scrollWidth <= innerWidth
          ),
          true
        )
        await page.screenshot(path.join(output, `update-form-${width}.png`), {
          animations: 'disabled'
        })
      }
      await panel
        .getByRole('button', { name: 'Review update', exact: true })
        .click()
      await expect(panel).toContainText('search:1.4 → search:1.5')
      await expect(panel).toContainText(
        'Cutover briefly interrupts connections.'
      )
      await expect(panel.getByRole('button')).toHaveCount(2)
      assert.ok(!(await page.raw.content()).includes('never-render-this'))
      await page.screenshot(path.join(output, 'update-review-mobile.png'), {
        animations: 'disabled'
      })
      await panel.getByRole('button', { name: 'Cancel', exact: true }).click()
      await sails.models.service.updateOne({ id: service.id }).set({
        customState: {
          ...service.customState,
          volumes: [{ name: 'data', path: '/data' }]
        }
      })
      await page.raw.reload()
      await expect(panel).toContainText('This service has persistent data.')
      await expect(panel.getByRole('button')).toHaveCount(0)
      await page.screenshot(
        path.join(output, 'persistent-update-unavailable.png'),
        { animations: 'disabled' }
      )
    } finally {
      custom.inspectImage = originalImage
      custom.inspectContainer = originalInspect
    }
  }
)
