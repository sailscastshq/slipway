const { test } = require('sounding')
const assert = require('node:assert/strict')
const fs = require('node:fs/promises')
const path = require('node:path')
const custom = require('../../../../api/lib/custom-service')

test(
  'custom HTTP route reviews use Klean, preserve dashed fields, and distinguish route from DNS and TLS',
  {
    browser: true,
    world: {
      name: 'configured-slipway',
      context: { deploymentTarget: { slug: 'custom-route-ui' } }
    }
  },
  async ({ sails, world, login, page, expect }) => {
    const service = await world.create('service').with({
      type: 'custom',
      name: 'Search',
      version: 'search:1.4',
      status: 'running',
      containerName: 'slipway-custom-search',
      containerId: 'search',
      internalPort: 8080,
      environment: world.current.environments.production.id,
      customState: {
        image: 'search:1.4',
        health: 'healthy',
        appIds: [],
        volumes: []
      }
    })
    const originalCommand = custom.command,
      originalVerify = sails.helpers.caddy.verifyRoute,
      originalFinish = sails.helpers.caddy.finishRouteUpdate
    custom.command = async (args) => {
      if (args[0] === 'inspect') {
        const error = new Error('missing')
        error.code = 'DOCKER_MISSING'
        throw error
      }
      return { stdout: '', stderr: '' }
    }
    sails.helpers.caddy.verifyRoute = { with: async () => ({}) }
    sails.helpers.caddy.finishRouteUpdate = { with: async () => ({}) }
    try {
      await login.withPassword('genesisUser', page, {
        password: world.current.auth.genesisUserPassword
      })
      await page.goto(
        `/projects/custom-route-ui/environments/production/services/${service.id}`
      )
      const panel = page.raw.locator('[data-test="custom-service-route"]')
      await expect(panel).toContainText('Private.')
      await panel
        .getByRole('button', { name: 'Add public route', exact: true })
        .click()
      await panel
        .getByLabel('Domain', { exact: true })
        .fill('search.example.com')
      const output = path.resolve('output/issue-527')
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
            .getByLabel('Domain', { exact: true })
            .evaluate((el) => getComputedStyle(el).borderBottomStyle),
          'dashed'
        )
        assert.equal(
          await page.raw.evaluate(
            () => document.documentElement.scrollWidth <= innerWidth
          ),
          true
        )
        await page.screenshot(path.join(output, `route-form-${width}.png`), {
          animations: 'disabled'
        })
      }
      await panel
        .getByRole('button', { name: 'Review route', exact: true })
        .click()
      await expect(panel).toContainText(
        'Publishing does not add authentication.'
      )
      await expect(panel).toContainText('http://slipway-custom-search:8080')
      await expect(panel.getByRole('button')).toHaveCount(2)
      await panel.scrollIntoViewIfNeeded()
      await page.screenshot(path.join(output, 'route-review-mobile.png'), {
        animations: 'disabled'
      })
      await panel
        .getByRole('button', { name: 'Publish route', exact: true })
        .click()
      await expect(panel).toContainText(
        'Route verified · DNS unverified · TLS unverified'
      )
      await panel.scrollIntoViewIfNeeded()
      await page.screenshot(path.join(output, 'route-published-mobile.png'), {
        animations: 'disabled'
      })
      await panel
        .getByRole('button', { name: 'Remove route', exact: true })
        .click()
      await expect(panel).toContainText('Make this service private?')
      await expect(panel.getByRole('button')).toHaveCount(2)
      await panel
        .getByRole('button', { name: 'Remove public route', exact: true })
        .click()
      await expect(panel).toContainText('Private.')
      expect(page).toHaveNoJavascriptErrors()
    } finally {
      custom.command = originalCommand
      sails.helpers.caddy.verifyRoute = originalVerify
      sails.helpers.caddy.finishRouteUpdate = originalFinish
    }
  }
)
