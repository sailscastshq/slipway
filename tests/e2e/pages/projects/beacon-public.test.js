const { test } = require('sounding')
const { spawnSync } = require('node:child_process')
const fs = require('node:fs')
const path = require('node:path')
const publicProxy = require('../../../support/beacon-public-proxy')
const config = require('../../../../api/lib/beacon/public-page')
const binary = process.env.SLIPWAY_CADDY_BINARY || 'caddy'
const hasCaddy =
  spawnSync(binary, ['version'], { stdio: 'ignore' }).status === 0

test(
  'public Beacon works anonymously on root and prefixed app origins through real Caddy',
  {
    skip: !hasCaddy,
    browser: true,
    world: {
      name: 'configured-slipway',
      context: {
        deploymentTarget: { slug: 'beacon-public-browser', name: 'Harbor' }
      }
    }
  },
  async ({ world, sails, login, page, expect }) => {
    const { apps, environments } = world.current
    const dashboard =
      '/projects/beacon-public-browser/environments/production/apps/web/beacon'
    const errors = []
    page.raw.on('pageerror', (error) => errors.push(error.message))
    await sails.models.environment
      .updateOne({ id: environments.production.id })
      .set({ domain: 'harbor.example.test' })
    await login.withPassword('genesisUser', page, {
      password: world.current.auth.genesisUserPassword
    })
    await page.goto(dashboard)
    await page.raw
      .getByRole('switch', { name: 'Enable public Beacon page' })
      .check()
    await page.raw.getByRole('button', { name: 'Save public page' }).click()
    await expect(page.raw.getByText(/Public Beacon page enabled/)).toBeVisible()
    await page.raw.context().clearCookies()
    fs.mkdirSync('.tmp/screenshots/beacon', { recursive: true })
    for (const mount of ['/', '/academy']) {
      await sails.models.app
        .updateOne({ id: apps.web.id })
        .set({ routePath: mount })
      await sails.helpers.setting.set(
        config.key(apps.web.id),
        JSON.stringify({ enabled: true })
      )
      const app = await sails.models.app.findOne({ id: apps.web.id })
      const environment = await sails.models.environment.findOne({
        id: environments.production.id
      })
      const proxy = await publicProxy(sails, environment, app, binary)
      try {
        const prefix = mount === '/' ? '' : mount
        await page.raw.setViewportSize(
          mount === '/'
            ? { width: 1280, height: 1100 }
            : { width: 390, height: 844 }
        )
        await page.goto(proxy.origin + prefix + '/beacon?preview=down')
        await expect(
          page.raw.getByRole('heading', { name: 'Unknown', exact: true })
        ).toBeVisible()
        await expect(
          page.raw.getByText('Harbor', { exact: true })
        ).toBeVisible()
        await expect(
          page.raw.getByText('Example preview', { exact: true })
        ).toHaveCount(0)
        await expect(
          page.raw.getByText('Active deployment', { exact: true })
        ).toHaveCount(0)
        expect(
          await page.raw.evaluate(
            () => document.documentElement.scrollWidth <= window.innerWidth
          )
        ).toBe(true)
        await page.raw.reload()
        await expect(
          page.raw.getByRole('heading', { name: 'Unknown', exact: true })
        ).toBeVisible()
        const stylesheet = await fetch(
          proxy.origin + prefix + '/beacon/_/appearance.css'
        )
        expect(stylesheet.status).toBe(200)
        await page.screenshot(
          path.resolve(
            '.tmp/screenshots/beacon',
            mount === '/'
              ? 'beacon-public-desktop.png'
              : 'beacon-public-mobile.png'
          ),
          { fullPage: true, animations: 'disabled' }
        )
        await page.raw.getByRole('link', { name: 'Return to Harbor' }).click()
        await expect(
          page.raw.getByRole('heading', { name: 'Harbor app' })
        ).toBeVisible()
        const unrelated = await fetch(proxy.origin + prefix + '/beaconish')
        expect(await unrelated.text()).toContain('Harbor app')
        await sails.helpers.setting.set(
          config.key(app.id),
          JSON.stringify({ enabled: false })
        )
        expect((await fetch(proxy.origin + prefix + '/beacon')).status).toBe(
          404
        )
        expect(
          (await fetch(proxy.origin + prefix + '/beacon/_/appearance.css'))
            .status
        ).toBe(404)
      } finally {
        await proxy.close()
      }
    }
    expect(errors).toEqual([])
  }
)
