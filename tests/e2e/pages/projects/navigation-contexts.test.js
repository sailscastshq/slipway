const fs = require('node:fs')
const path = require('node:path')
const assert = require('node:assert/strict')
const { test } = require('sounding')

test(
  'Breadcrumb switchers protect drafts, reset Bearing context, and support narrow screens and history',
  {
    browser: true,
    world: {
      name: 'configured-slipway',
      context: {
        deploymentTarget: {
          slug: 'navigation-studio',
          name: 'Navigation Studio'
        }
      }
    }
  },
  async ({ sails, world, login, page, expect }) => {
    const current = world.current
    const project = current.projects.deploymentTarget
    const env = current.environments.production
    const app = current.apps.web
    const other = await world
      .create('app')
      .with({ name: 'Companion', slug: 'companion', environment: env.id })
    await world
      .create('environment')
      .with({ name: 'Staging', slug: 'staging', project: project.id })
    await world.create('project').with({
      name: 'Second studio',
      slug: 'second-studio',
      team: current.teams.genesisTeam.id
    })
    const base = `/projects/${project.slug}/environments/${env.slug}/apps/`
    const first = `${base}${app.slug}/bearing`
    const second = `${base}${other.slug}/bearing`
    const root = path.resolve('.tmp/screenshots/issue-893')
    fs.mkdirSync(root, { recursive: true })
    const errors = []
    page.raw.on('pageerror', (error) => errors.push(error.message))
    await login.withPassword('genesisUser', page, {
      password: current.auth.genesisUserPassword
    })
    await page.resize(1440, 1000)
    await page.goto(first + '?view=updates')
    const trigger = () => page.raw.getByRole('button', { name: /^Switch app:/ })
    const menu = () =>
      page.raw
        .locator('[data-slot="popover-content"][data-state="open"]')
        .last()
    let failLoad = true
    await page.raw.route('**/api/v1/navigation/contexts?**', async (route) => {
      if (failLoad)
        await route.fulfill({
          status: 503,
          contentType: 'application/json',
          body: '{}'
        })
      else await route.continue()
    })
    await trigger().click()
    await menu()
      .getByText('This context is unavailable. Your access may have changed.')
      .waitFor()
    failLoad = false
    await menu().getByRole('button', { name: 'Try again' }).click()
    await menu().getByRole('link', { name: 'Companion', exact: true }).waitFor()
    await page.raw.screenshot({
      path: path.join(root, 'desktop-app-switcher.png')
    })
    await page.inDarkMode()
    await page.raw.screenshot({
      path: path.join(root, 'desktop-app-switcher-dark.png')
    })
    await page.inLightMode()
    await menu().getByRole('textbox', { name: 'Search apps' }).fill('missing')
    await expect(page).toSee('No matches.')
    await menu().getByRole('textbox', { name: 'Search apps' }).fill('Comp')
    await page.raw.keyboard.press('ArrowDown')
    assert.equal(
      await page.raw.evaluate(() => document.activeElement.textContent.trim()),
      'Companion'
    )
    await page.raw.keyboard.press('Escape')
    assert.equal(
      await trigger().evaluate((el) => el === document.activeElement),
      true
    )
    await trigger().click()
    await menu().getByRole('link', { name: 'Companion', exact: true }).click()
    await page.raw.waitForURL('**' + second)
    assert.equal(new URL(page.raw.url()).search, '')
    await expect(page).toSee('Bearing')
    await page.raw.screenshot({
      path: path.join(root, 'desktop-bearing-destination.png')
    })
    await page.raw.goBack()
    await page.raw.waitForURL('**' + first + '?view=updates')
    await page.raw.goForward()
    await page.raw.waitForURL('**' + second)
    await trigger().click()
    await menu().getByRole('link', { name: 'Companion', exact: true }).click()
    assert.equal(new URL(page.raw.url()).pathname, second)
    // Use the page's existing draft guard rather than a switcher-specific confirmation.
    await page.raw.getByRole('tab', { name: /updates/i }).click()
    await page.raw
      .getByLabel('Update title', { exact: true })
      .fill('An unsaved announcement')
    await trigger().click()
    await menu().getByRole('link', { name: app.name, exact: true }).click()
    await expect(page).toSee('You have unsaved update changes.')
    await page.raw.getByRole('button', { name: /keep editing/i }).click()
    assert.equal(new URL(page.raw.url()).pathname, second)
    await page.resize(390, 844)
    await trigger().click()
    await menu().getByRole('link', { name: app.name, exact: true }).waitFor()
    await page.raw.screenshot({
      path: path.join(root, 'mobile-app-switcher.png')
    })
    await page.inDarkMode()
    await page.raw.screenshot({
      path: path.join(root, 'mobile-app-switcher-dark.png')
    })
    await page.inLightMode()
    await menu().getByRole('link', { name: app.name, exact: true }).click()
    await page.raw.getByRole('button', { name: /discard.*continue/i }).click()
    await page.raw.waitForURL('**' + first)
    await page.raw.screenshot({
      path: path.join(root, 'mobile-bearing-destination.png')
    })
    await page.raw
      .getByRole('button', { name: 'Show project and environment breadcrumbs' })
      .click()
    await page.raw
      .getByRole('button', { name: /^Switch environment:/ })
      .filter({ visible: true })
      .click()
    await menu().getByRole('link', { name: 'Staging', exact: true }).waitFor()
    await page.raw.screenshot({
      path: path.join(root, 'mobile-environment-switcher.png')
    })
    await menu().getByRole('link', { name: 'Staging', exact: true }).click()
    await page.raw.waitForURL(
      `**/projects/${project.slug}/environments/staging`
    )
    await page.resize(1440, 1000)
    await page.raw.getByRole('button', { name: /^Switch project:/ }).click()
    await menu()
      .getByRole('link', { name: 'Second studio', exact: true })
      .waitFor()
    await page.raw.screenshot({
      path: path.join(root, 'desktop-project-switcher.png')
    })
    await menu()
      .getByRole('link', { name: 'Second studio', exact: true })
      .click()
    await page.raw.waitForURL('**/projects/second-studio')
    await page.goto(first)
    // An interrupted load must not populate a later opening with stale choices.
    await page.raw.unroute('**/api/v1/navigation/contexts?**')
    let release
    const held = new Promise((resolve) => {
      release = resolve
    })
    await page.raw.route('**/api/v1/navigation/contexts?**', async (route) => {
      await held
      await route.continue().catch(() => {})
    })
    await trigger().click()
    await menu().getByRole('status').filter({ hasText: 'Loading' }).waitFor()
    await page.raw.keyboard.press('Escape')
    release()
    await page.raw.unroute('**/api/v1/navigation/contexts?**')
    await sails.models.app.destroyOne({ id: other.id })
    await trigger().click()
    await menu().getByRole('link', { name: app.name, exact: true }).waitFor()
    assert.equal(
      await menu()
        .getByRole('link', { name: 'Companion', exact: true })
        .count(),
      0
    )
    // Recheck live authorization after membership is revoked while the page is open.
    await page.raw.keyboard.press('Escape')
    await sails.models.teammembership.destroy({
      user: current.users.genesisUser.id,
      team: current.teams.genesisTeam.id
    })
    await trigger().click()
    await menu()
      .getByText('This context is unavailable. Your access may have changed.')
      .waitFor()
    assert.deepEqual(errors, [])
  }
)
