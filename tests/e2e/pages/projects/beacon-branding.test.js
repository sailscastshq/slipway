const { test } = require('sounding')
const { spawnSync } = require('node:child_process')
const fs = require('node:fs')
const path = require('node:path')
const publicProxy = require('../../../support/beacon-public-proxy')
const publicConfig = require('../../../../api/lib/beacon/public-page')
const appearanceStore = require('../../../../api/lib/app-appearance-store')
const contract = require('../../../../api/lib/app-appearance')
const binary = process.env.SLIPWAY_CADDY_BINARY || 'caddy'
const hasCaddy =
  spawnSync(binary, ['version'], { stdio: 'ignore' }).status === 0

test(
  'Beacon shares app logo settings, honours theme modes and retains a readable brand on image failures',
  {
    skip: !hasCaddy,
    browser: true,
    world: {
      name: 'configured-slipway',
      context: { deploymentTarget: { slug: 'beacon-branding', name: 'Harbor' } }
    }
  },
  async ({ world, sails, login, page, expect }) => {
    const { apps, environments } = world.current
    const base = '/projects/beacon-branding/environments/production/apps/web'
    await sails.models.environment
      .updateOne({ id: environments.production.id })
      .set({ domain: 'harbor.example.test' })
    await sails.models.app
      .updateOne({ id: apps.web.id })
      .set({ routePath: '/academy' })
    await sails.helpers.setting.set(
      publicConfig.key(apps.web.id),
      JSON.stringify({ enabled: true })
    )
    await login.withPassword('genesisUser', page, {
      password: world.current.auth.genesisUserPassword
    })
    await page.goto(base + '/beacon')
    await page.raw
      .getByRole('link', { name: 'Edit app logo and colour mode' })
      .click()
    await expect(
      page.raw.getByRole('heading', { name: 'App appearance' })
    ).toBeVisible()
    await page.raw.locator('#appearance-name').fill('Tembo')
    await page.raw
      .locator('#appearance-logoLight')
      .setInputFiles(path.resolve('tests/fixtures/appearance/tembo-logo.png'))
    await page.raw
      .locator('#appearance-logoDark')
      .setInputFiles(
        path.resolve('tests/fixtures/appearance/tembo-logo-dark.png')
      )
    await expect(
      page.raw.locator('label[for="appearance-logoLight"] img')
    ).toBeVisible()
    await expect(
      page.raw.locator('label[for="appearance-logoDark"] img')
    ).toBeVisible()
    await page.raw.locator('[data-test="save-appearance"]').click()
    await expect(
      page.raw.getByText('App appearance saved.', { exact: true })
    ).toBeVisible()
    const app = await sails.models.app.findOne({ id: apps.web.id })
    const environment = await sails.models.environment.findOne({
      id: environments.production.id
    })
    const stored = await appearanceStore.read(app)
    const proxy = await publicProxy(sails, environment, app, binary)
    const output = path.resolve('.tmp/screenshots/beacon')
    fs.mkdirSync(output, { recursive: true })
    const target = proxy.origin + '/academy/beacon'
    const brand = page.raw.locator('.app-brand')
    const light = brand.locator('.app-logo-light')
    const dark = brand.locator('.app-logo-dark')
    const mode = page.raw.locator('.app-appearance')
    const canvas = page.raw.locator('.app-appearance > div')
    const errors = []
    page.raw.on('pageerror', (error) => errors.push(error.message))
    await page.raw.context().clearCookies()
    const write = async (patch) =>
      sails.helpers.setting.set(
        appearanceStore.keyFor(app),
        JSON.stringify({ ...stored, ...patch })
      )
    const contrast = async () => {
      const colors = await canvas.evaluate((element) => {
        const paragraph = element.querySelector('main > p:nth-of-type(2)')
        return {
          foreground: getComputedStyle(paragraph).color,
          background: getComputedStyle(element).backgroundColor
        }
      })
      const hex = (rgb) =>
        '#' +
        rgb
          .match(/\d+/g)
          .slice(0, 3)
          .map((n) => Number(n).toString(16).padStart(2, '0'))
          .join('')
      expect(
        contract.contrast(hex(colors.foreground), hex(colors.background)) >= 4.5
      ).toBe(true)
    }
    try {
      await page.raw.setViewportSize({ width: 1280, height: 1100 })
      await page.raw.emulateMedia({ colorScheme: 'light' })
      await page.goto(target)
      await expect(mode).toHaveAttribute('data-appearance-mode', 'light')
      await expect(light).toBeVisible()
      await expect(dark).toBeHidden()
      await expect(light).toHaveJSProperty('complete', true)
      expect(
        await light.evaluate(
          (image) => image.complete && image.naturalWidth > 0
        )
      ).toBe(true)
      await contrast()
      await page.screenshot(path.join(output, 'beacon-logo-light.png'), {
        fullPage: true,
        animations: 'disabled'
      })
      await page.raw.emulateMedia({ colorScheme: 'dark' })
      await expect(mode).toHaveAttribute('data-appearance-mode', 'dark')
      await expect(dark).toBeVisible()
      await expect(light).toBeHidden()
      await expect(dark).toHaveJSProperty('complete', true)
      expect(
        await dark.evaluate((image) => image.complete && image.naturalWidth > 0)
      ).toBe(true)
      await contrast()
      await page.screenshot(path.join(output, 'beacon-logo-dark.png'), {
        fullPage: true,
        animations: 'disabled'
      })
      await write({ mode: 'light' })
      await page.raw.reload()
      await expect(mode).toHaveAttribute('data-appearance-mode', 'light')
      await expect(light).toBeVisible()
      await write({ mode: 'dark' })
      await page.raw.emulateMedia({ colorScheme: 'light' })
      await page.raw.reload()
      await expect(mode).toHaveAttribute('data-appearance-mode', 'dark')
      await expect(dark).toBeVisible()
      await write({ mode: 'host', fallbackMode: 'dark' })
      await page.raw.reload()
      await expect(mode).toHaveAttribute('data-appearance-mode', 'dark')
      await write({ mode: 'dark', logoDark: null })
      await page.raw.reload()
      await expect(light).toBeVisible()
      await expect(dark).toHaveCount(0)
      await expect(brand.locator('.app-brand-single')).toHaveCSS(
        'background-color',
        'rgb(255, 255, 255)'
      )
      await page.screenshot(path.join(output, 'beacon-logo-single-dark.png'), {
        fullPage: true,
        animations: 'disabled'
      })
      await write({ mode: 'system' })
      await page.raw.emulateMedia({ colorScheme: 'dark' })
      await page.raw.route('**/beacon/_/appearance/logo/light?*', (route) =>
        route.abort()
      )
      await page.raw.reload()
      await expect(light).toHaveCount(0)
      await expect(dark).toBeVisible()
      await expect(brand.locator('.app-brand-dark-only')).toHaveCSS(
        'background-color',
        'rgb(10, 10, 10)'
      )
      await page.raw.route('**/beacon/_/appearance/logo/dark?*', (route) =>
        route.abort()
      )
      await page.raw.reload()
      await expect(brand.locator('img')).toHaveCount(0)
      await expect(brand).toHaveText('Tembo')
      await page.raw.unroute('**/beacon/_/appearance/logo/light?*')
      await page.raw.unroute('**/beacon/_/appearance/logo/dark?*')
      await sails.models.setting.destroy({ key: appearanceStore.keyFor(app) })
      await page.raw.reload()
      await expect(mode).toHaveAttribute('data-appearance-mode', 'dark')
      await expect(brand).toHaveText('Harbor')
      await expect(brand.locator('img')).toHaveCount(0)
      await contrast()
      await page.raw.setViewportSize({ width: 390, height: 844 })
      expect(
        await page.raw.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth
        )
      ).toBe(true)
      await page.screenshot(
        path.join(output, 'beacon-logo-fallback-mobile-dark.png'),
        { fullPage: true, animations: 'disabled' }
      )
      await page.raw.emulateMedia({ colorScheme: 'light' })
      await expect(mode).toHaveAttribute('data-appearance-mode', 'light')
      await contrast()
      expect(errors).toEqual([])
    } finally {
      await proxy.close()
    }
  }
)
