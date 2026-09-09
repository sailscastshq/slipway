const { test } = require('sounding')
const fs = require('node:fs/promises')
const os = require('node:os')
const path = require('node:path')
test(
  'shared readiness keeps advisory deploy enabled and renders blockers with Klean on mobile and desktop',
  {
    browser: true,
    world: {
      name: 'configured-slipway',
      context: { deploymentTarget: { slug: 'readiness-ui' } }
    }
  },
  async ({ sails, world, login, page, expect }) => {
    const root = await fs.mkdtemp(
      path.join(os.tmpdir(), 'slipway-readiness-ui-')
    )
    const old = sails.config.custom.slipwayAppsDir
    sails.config.custom.slipwayAppsDir = root
    const appPath = path.join(root, 'readiness-ui')
    const current = world.current
    try {
      await fs.mkdir(appPath)
      await fs.writeFile(
        path.join(appPath, 'Dockerfile'),
        'FROM node:22-alpine'
      )
      await fs.writeFile(
        path.join(appPath, 'package.json'),
        JSON.stringify({
          dependencies: {
            sails: '^1.5.0',
            'sails-postgresql': '^5.0.0',
            'sails-hook-slipway': '^1.2.0'
          }
        })
      )
      await sails.models.app
        .updateOne({ id: current.apps.web.id })
        .set({ status: 'stopped', containerName: null, containerId: null })
      await sails.models.environment
        .updateOne({ id: current.environments.production.id })
        .set({
          envVars: {
            DATABASE_URL: 'postgres://private:password@external.test/app'
          }
        })
      await login.withPassword('genesisUser', page, {
        password: current.auth.genesisUserPassword
      })
      await page.raw.waitForURL('**/')
      await page.goto(
        `/projects/readiness-ui/environments/production/apps/${current.apps.web.slug}`
      )
      const report = page.raw.locator('[data-test="deployment-checklist"]')
      await expect(report).toHaveAttribute('data-slot', 'alert')
      await expect(report).toContainText('0 blockers')
      const slide = page.raw.locator('[data-slot="slide"]')
      await expect(slide).toBeEnabled()
      await report.locator('summary').click()
      await expect(report).toContainText('Bridge and Lookout')
      await expect(report).toContainText(
        'A database connection URL is configured'
      )
      expect((await report.textContent()).includes('password@')).toBe(false)
      const output = path.resolve('output/issue-373')
      await fs.mkdir(output, { recursive: true })
      for (const [width, colorScheme] of [
        [1280, 'light'],
        [390, 'dark']
      ]) {
        await page.raw.setViewportSize({ width, height: 900 })
        await page.raw.emulateMedia({ colorScheme })
        expect(
          await page.raw.evaluate(
            () => document.documentElement.scrollWidth <= window.innerWidth
          )
        ).toBe(true)
        await report.getByRole('heading', { level: 2 }).scrollIntoViewIfNeeded()
        await page.screenshot(path.join(output, `readiness-${width}.png`), {
          animations: 'disabled'
        })
      }
      await fs.rm(path.join(appPath, 'Dockerfile'))
      await report.getByRole('button', { name: 'Refresh', exact: true }).click()
      await expect(report).toContainText('1 blocker')
      await expect(slide).toBeDisabled()
      await report.getByRole('heading', { level: 2 }).scrollIntoViewIfNeeded()
      await page.screenshot(path.join(output, 'blocker-390.png'), {
        animations: 'disabled'
      })
      expect(page).toHaveNoJavascriptErrors()
    } finally {
      sails.config.custom.slipwayAppsDir = old
      await fs.rm(root, { recursive: true, force: true })
    }
  }
)
