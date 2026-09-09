const { test } = require('sounding')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')

test(
  'Dock explains unavailable schema snapshots and never offers an approximate migration',
  {
    browser: true,
    world: {
      name: 'configured-slipway',
      context: { deploymentTarget: { slug: 'schema-unavailable' } }
    }
  },
  async ({ sails, world, login, page, expect }) => {
    const root = fs.mkdtempSync(
      path.join(os.tmpdir(), 'slipway-schema-source-')
    )
    const original = sails.config.custom.slipwayAppsDir
    const modelsPath = path.join(root, 'schema-unavailable/api/models')
    fs.mkdirSync(modelsPath, { recursive: true })
    fs.writeFileSync(
      path.join(modelsPath, 'User.js'),
      "module.exports = { attributes: { email: { type: 'string', unique: true } } }"
    )
    sails.config.custom.slipwayAppsDir = root
    try {
      const current = world.current
      const database = await world
        .create('service')
        .with({
          name: 'primary-db',
          type: 'postgresql',
          version: '17',
          status: 'running',
          environment: current.environments.production.id,
          database: 'app'
        })
      await page.raw.route('**/dock/tables?**', (route) =>
        route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ tables: [] })
        })
      )
      await login.withPassword('genesisUser', page, {
        password: current.auth.genesisUserPassword
      })
      await page.raw.waitForURL('**/')
      await page.goto(
        `/projects/schema-unavailable/environments/production/dock/${database.id}?tab=migrate`
      )
      const alert = page.raw
        .getByRole('alert')
        .filter({ hasText: 'Source files alone cannot confirm' })
      await expect(alert).toHaveAttribute('data-slot', 'alert')
      await expect(alert).toBeVisible()
      expect(
        await page.raw
          .getByRole('button', { name: 'Apply', exact: true })
          .count()
      ).toBe(0)
      const output = path.resolve('output/issue-369')
      fs.mkdirSync(output, { recursive: true })
      for (const [width, colorScheme] of [
        [1280, 'light'],
        [390, 'dark']
      ]) {
        await page.raw.setViewportSize({ width, height: 850 })
        await page.raw.emulateMedia({ colorScheme })
        await page.screenshot(path.join(output, `unavailable-${width}.png`), {
          animations: 'disabled'
        })
      }
    } finally {
      sails.config.custom.slipwayAppsDir = original
      fs.rmSync(root, { recursive: true, force: true })
    }
  }
)
