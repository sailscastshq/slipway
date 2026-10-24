const { test } = require('sounding')
const fs = require('node:fs')
const path = require('node:path')

test(
  'CI is reachable from app actions and the launcher for running and stopped apps in the selected environment',
  {
    browser: true,
    world: {
      name: 'configured-slipway',
      context: { deploymentTarget: { slug: 'sailsconf', name: 'Sailsconf' } }
    }
  },
  async ({ sails, world, login, page, expect }) => {
    const { apps, environments, projects } = world.current
    const app = apps.web
    const project = projects.deploymentTarget
    const staging = await world
      .create('environment')
      .with({ project: project.id })
    const stagingApp = await world.create('app').trait('configured').with({
      environment: staging.id,
      name: 'sailsconf.com'
    })
    const appPath = `/projects/${project.slug}/environments/${environments.production.slug}/apps/${app.slug}`
    const stagingCi = `/projects/${project.slug}/environments/${staging.slug}/apps/${stagingApp.slug}/ci`
    const output = path.resolve('.tmp/screenshots/issue-857-ci-navigation')
    fs.mkdirSync(output, { recursive: true })
    const original = sails.helpers.docker.getContainerStatus
    let running = true
    sails.helpers.docker.getContainerStatus = async () => ({
      running,
      health: running ? 'healthy' : null
    })
    try {
      await sails.models.app.updateOne({ id: app.id }).set({
        name: 'sailsconf.com',
        status: 'running',
        containerName: 'ci-navigation-web'
      })
      await login.withPassword('genesisUser', page, {
        password: world.current.auth.genesisUserPassword
      })
      await page.raw.waitForURL('**/')
      await page.raw.route('**/api/v1/system/check-update', (route) =>
        route.fulfill({ json: { updateAvailable: false } })
      )
      await page.resize(1440, 1000)
      for (const theme of ['light', 'dark']) {
        await page.raw.emulateMedia({
          colorScheme: theme,
          reducedMotion: 'reduce'
        })
        await page.goto(appPath)
        await page.click('@app-more-menu')
        const link = page.raw.getByRole('menuitem', { name: 'CI', exact: true })
        await expect(link).toBeVisible()
        await expect(link).toHaveAttribute('href', appPath + '/ci')
        await page.screenshot(path.join(output, `app-menu-${theme}.png`), {
          animations: 'disabled'
        })
        await page.raw.locator('#app-more-actions').screenshot({
          path: path.join(output, `app-menu-detail-${theme}.png`),
          animations: 'disabled'
        })
        await link.click()
        await page.raw.waitForURL('**' + appPath + '/ci')
        await expect(
          page.raw.getByRole('heading', { name: 'No checks have run yet' })
        ).toBeVisible()
      }
      running = false
      await sails.models.app
        .updateOne({ id: app.id })
        .set({ status: 'stopped' })
      await page.goto(appPath)
      await page.click('@app-more-menu')
      await expect(
        page.raw.getByRole('menuitem', { name: 'CI', exact: true })
      ).toBeVisible()
      await page.key('Escape')
      await page.goto('/')
      await page.key('Control+k')
      const input = page.raw.getByPlaceholder('Type a command or search...')
      await expect(input).toBeVisible()
      await expect(
        page.raw.getByText('Loading projects, apps, and services…')
      ).toBeHidden()
      await input.fill('CI')
      await expect(
        page.raw.getByRole('option', { name: /Go to CI/ })
      ).toBeVisible()
      await page.screenshot(path.join(output, 'launcher-ci-dark.png'), {
        animations: 'disabled'
      })
      await expect(page.raw.getByRole('option').first()).toContainText(
        'Go to CI'
      )
      await page.key('Enter')
      const target = page.raw
        .getByRole('option')
        .filter({ hasText: 'Sailsconf / Staging' })
      await expect(target).toBeVisible()
      await expect(
        page.raw
          .getByRole('option')
          .filter({ hasText: 'Sailsconf / Production' })
      ).toBeVisible()
      await page.screenshot(path.join(output, 'launcher-apps-dark.png'), {
        animations: 'disabled'
      })
      await page.raw.locator('[data-slot="command"]').screenshot({
        path: path.join(output, 'launcher-detail-dark.png'),
        animations: 'disabled'
      })
      await page.resize(390, 844)
      await expect(target).toBeInViewport()
      await page.screenshot(
        path.join(output, 'launcher-apps-mobile-dark.png'),
        { animations: 'disabled' }
      )
      await target.click()
      await page.raw.waitForURL('**' + stagingCi)
      await expect(
        page.raw.getByRole('heading', { name: 'No checks have run yet' })
      ).toBeVisible()
      expect(page).toHaveNoJavascriptErrors()
    } finally {
      sails.helpers.docker.getContainerStatus = original
    }
  }
)
