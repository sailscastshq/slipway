const { test } = require('sounding')
const fs = require('node:fs/promises')
const os = require('node:os')
const path = require('node:path')

test(
  'deployment checks stay available on demand while blockers gate deployment',
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
    const appUrl = `/projects/readiness-ui/environments/production/apps/${current.apps.web.slug}`
    const environmentUrl =
      '/projects/readiness-ui/environments/production?apps=1'
    const output = path.resolve('output/issue-907')
    try {
      await fs.mkdir(appPath)
      await fs.mkdir(output, { recursive: true })
      await fs.writeFile(
        path.join(appPath, 'Dockerfile'),
        'FROM node:24-alpine'
      )
      await fs.writeFile(
        path.join(appPath, 'package.json'),
        JSON.stringify({
          scripts: { start: 'node app.js' },
          dependencies: {
            sails: '^1.5.0',
            'sails-postgresql': '^5.0.0'
          }
        })
      )
      await sails.models.app.updateOne({ id: current.apps.web.id }).set({
        name: 'Studios',
        status: 'stopped',
        containerName: null,
        containerId: null
      })
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
      await page.goto(appUrl)
      const report = page.raw.locator('[data-test="deployment-checklist"]')
      const trigger = page.raw.getByRole('button', {
        name: 'View deployment checks',
        exact: true
      })
      const blockers = page.raw.locator('[data-test="deployment-blockers"]')
      const slide = page.raw.locator('[data-slot="slide"]')
      await expect(trigger).toBeVisible()
      await expect(report).not.toBeVisible()
      await expect(blockers).toHaveCount(0)
      await expect(slide).toBeEnabled()

      for (const [width, colorScheme] of [
        [1280, 'light'],
        [1280, 'dark'],
        [390, 'light'],
        [390, 'dark']
      ]) {
        await page.raw.setViewportSize({ width, height: 900 })
        await page.raw.emulateMedia({ colorScheme })
        await trigger.focus()
        await trigger.press('Enter')
        await expect(report).toBeVisible()
        await expect(report).toHaveAccessibleName('Deployment checks')
        await expect(
          report.getByRole('button', { name: 'Done', exact: true })
        ).toBeFocused()
        for (const key of ['Tab', 'Tab', 'Tab', 'Shift+Tab', 'Shift+Tab']) {
          await page.raw.keyboard.press(key)
          // Native dialogs may send Tab to browser chrome (activeElement is
          // body), but never to an interactive control on the inert page.
          expect(
            await report.evaluate(
              (el) =>
                el.contains(document.activeElement) ||
                document.activeElement === document.body
            )
          ).toBe(true)
        }
        await trigger.focus()
        await expect(trigger).not.toBeFocused()
        await expect(report).toContainText('No deployment blockers.')
        await expect(report).toContainText('Recommendations')
        await expect(report).toContainText('Verified checks')
        await expect(report).toContainText('Optional capabilities')
        await expect(report).toContainText('Bridge and Lookout')
        await expect(report).toContainText(
          'A database connection URL is configured'
        )
        expect((await report.textContent()).includes('password@')).toBe(false)
        await expect(
          report.getByRole('button', { name: 'Generate secret', exact: true })
        ).toHaveCount(0)
        expect(
          await report.evaluate((el) => el.scrollWidth <= el.clientWidth)
        ).toBe(true)
        expect(
          await page.raw.evaluate(
            () => document.documentElement.scrollWidth <= window.innerWidth
          )
        ).toBe(true)
        await page.screenshot(
          path.join(output, `checks-${width}-${colorScheme}.png`),
          { animations: 'disabled' }
        )
        await page.raw.keyboard.press('Escape')
        await expect(report).not.toBeVisible()
        await expect(trigger).toBeFocused()
        await trigger.click()
        await report.getByRole('button', { name: 'Done', exact: true }).click()
        await expect(report).not.toBeVisible()
        await expect(trigger).toBeFocused()
        await trigger.click()
        await page.raw.mouse.click(8, 8)
        await expect(report).not.toBeVisible()
        await expect(trigger).toBeFocused()
        expect(new URL(page.raw.url()).pathname).toBe(appUrl)
      }
      // Configured names and health paths can contain long, unbroken segments.
      const longName = 'S'.repeat(120)
      await sails.models.app.updateOne({ id: current.apps.web.id }).set({
        name: longName,
        healthPath: `/health/${'x'.repeat(160)}`
      })
      await trigger.click()
      await report
        .getByRole('button', { name: 'Refresh checks', exact: true })
        .click()
      await expect(report).toContainText(`/health/${'x'.repeat(160)}`)
      expect(
        await report
          .getByText(longName, { exact: false })
          .evaluate((el) => el.scrollWidth <= el.clientWidth)
      ).toBe(true)
      expect(
        await report
          .locator('[data-test=deployment-checks-content]')
          .evaluate((el) => el.scrollWidth <= el.clientWidth)
      ).toBe(true)
      await sails.models.app.updateOne({ id: current.apps.web.id }).set({
        name: 'Studios',
        healthPath: '/health'
      })
      await report
        .getByRole('button', { name: 'Refresh checks', exact: true })
        .click()
      await report.getByRole('button', { name: 'Done', exact: true }).click()

      await page.raw.setViewportSize({ width: 1280, height: 900 })
      await page.raw.emulateMedia({ colorScheme: 'light' })
      await page.raw
        .getByRole('heading', { name: 'Studios', exact: true })
        .click()
      await page.screenshot(path.join(output, 'action-desktop.png'), {
        animations: 'disabled'
      })

      // Refresh preserves the open review and updates the same report that gates deployment.
      await trigger.click()
      await fs.rm(path.join(appPath, 'Dockerfile'))
      await report
        .getByRole('button', { name: 'Refresh checks', exact: true })
        .click()
      await expect(report).toBeVisible()
      await expect(report).toContainText('1 required check needs attention.')
      await expect(blockers).toContainText('1 deployment blocker')
      await expect(blockers).toContainText('Docker build')
      await expect(blockers).toHaveAttribute('role', 'alert')
      await expect(slide).toBeDisabled()
      await page.screenshot(path.join(output, 'blocker-desktop.png'), {
        animations: 'disabled'
      })
      await fs.writeFile(
        path.join(appPath, 'Dockerfile'),
        'FROM node:24-alpine'
      )
      await report
        .getByRole('button', { name: 'Refresh checks', exact: true })
        .click()
      await expect(report).toBeVisible()
      await expect(report).toContainText('No deployment blockers.')
      await expect(blockers).toHaveCount(0)
      await expect(slide).toBeEnabled()
      await report.getByRole('button', { name: 'Done', exact: true }).click()

      // The environment retains its existing permitted secret-generation action.
      await page.goto(environmentUrl)
      await trigger.click()
      await expect(
        report.getByRole('button', { name: 'Generate secret', exact: true })
      ).toBeVisible()
      await page.screenshot(
        path.join(output, 'checks-with-action-desktop.png'),
        { animations: 'disabled' }
      )
      await report
        .getByRole('button', { name: 'Generate secret', exact: true })
        .click()
      await expect(report).not.toBeVisible()
      await trigger.click()
      await expect(report).toContainText(
        'A session secret is configured; its value is never returned.'
      )
      await expect(
        report.getByRole('button', { name: 'Generate secret', exact: true })
      ).toHaveCount(0)
      await page.raw.keyboard.press('Escape')

      // Unavailable local source stays reviewable and is not a running-health claim.
      await fs.rm(appPath, { recursive: true })
      await page.raw.reload()
      await trigger.click()
      await expect(report).toContainText('Local source inspection unavailable')
      await expect(report).toContainText("the running app's health")
      await page.raw.goBack()
      await expect(report).not.toBeVisible()
      await page.raw.goForward()
      await expect(report).not.toBeVisible()
      await trigger.click()
      await expect(report).toBeVisible()
      await report.getByRole('button', { name: 'Done', exact: true }).click()
      // Same-page app navigation must close an open review rather than show
      // the previous app's report over the newly selected app.
      const other = await world.create('app').with({
        name: 'Companion',
        slug: 'companion',
        environment: current.environments.production.id
      })
      await page.goto(appUrl)
      await page.raw.getByRole('button', { name: /^Switch app:/ }).click()
      await page.raw
        .getByRole('link', { name: 'Companion', exact: true })
        .click()
      await page.raw.waitForURL(`**/apps/${other.slug}`)
      await trigger.click()
      await expect(report).toContainText('Companion')
      await page.raw.goBack()
      await page.raw.waitForURL('**' + appUrl)
      await expect(report).not.toBeVisible()
      await expect(trigger).toHaveAttribute('aria-expanded', 'false')
      await trigger.click()
      await expect(report).toContainText('Studios')
      await page.raw.goForward()
      await page.raw.waitForURL(`**/apps/${other.slug}`)
      await expect(report).not.toBeVisible()
      expect(page).toHaveNoJavascriptErrors()
    } finally {
      sails.config.custom.slipwayAppsDir = old
      await fs.rm(root, { recursive: true, force: true })
    }
  }
)
