const fs = require('node:fs')
const path = require('node:path')
const { test } = require('sounding')

test(
  'app actions expose one internal Bridge entry',
  {
    browser: true,
    world: {
      name: 'configured-slipway',
      context: {
        deploymentTarget: {
          slug: 'bridge-app-menu',
          name: 'Bridge App Menu'
        }
      }
    }
  },
  async ({ sails, world, login, page, expect }) => {
    const current = world.current
    const app = current.apps.web
    const environment = current.environments.production
    const project = current.projects.deploymentTarget
    const originalGetContainerStatus = sails.helpers.docker.getContainerStatus

    try {
      await sails.models.app.updateOne({ id: app.id }).set({
        bridgeEnabled: true,
        status: 'running',
        containerName: 'bridge-app-menu-web'
      })
      sails.helpers.docker.getContainerStatus = async () => ({
        running: true,
        health: 'healthy'
      })

      await login.withPassword('genesisUser', page, {
        password: current.auth.genesisUserPassword
      })
      const appPath = `/projects/${project.slug}/environments/${environment.slug}/apps/${app.slug}`
      await page.goto(appPath)
      await page.click('@app-more-menu')

      const bridgeLink = page.raw.getByRole('link', {
        name: 'Bridge',
        exact: true
      })
      await bridgeLink.waitFor({ state: 'visible' })
      expect(await bridgeLink.getAttribute('href')).toBe(`${appPath}/bridge`)
      await expect(page).not.toSee('Bridge in Slipway')
      await expect(page).not.toSee('Public Bridge')
      expect(page).toHaveNoJavascriptErrors()
    } finally {
      sails.helpers.docker.getContainerStatus = originalGetContainerStatus
    }
  }
)

test(
  'Bridge access manager stays minimal and legible in light and dark mode',
  {
    browser: true,
    world: {
      name: 'configured-slipway',
      context: {
        deploymentTarget: {
          slug: 'bridge-access-ui',
          name: 'Bridge Access UI'
        }
      }
    }
  },
  async ({ sails, world, login, page, expect }) => {
    const current = world.current
    const app = current.apps.web
    const environment = current.environments.production
    const project = current.projects.deploymentTarget
    const screenshotRoot = path.resolve(
      '.tmp/screenshots/issue-223-bridge-access'
    )
    fs.mkdirSync(screenshotRoot, { recursive: true })

    await sails.models.environment.updateOne({ id: environment.id }).set({
      domain: 'academy.example.com',
      features: {
        'sails-hook-slipway': { version: '0.1.0' }
      }
    })
    await sails.models.app.updateOne({ id: app.id }).set({
      bridgeEnabled: true
    })

    await world.create('bridgeaccess').with({
      email: 'ada@example.com',
      role: 'administrator',
      status: 'active',
      hostUserId: 'host-ada',
      hostUserName: 'Ada Lovelace',
      activatedAt: Date.now() - 7 * 24 * 60 * 60 * 1000,
      lastUsedAt: Date.now() - 3 * 60 * 1000,
      app: app.id,
      environment: environment.id,
      project: project.id,
      team: current.teams.genesisTeam.id,
      invitedBy: current.users.genesisUser.id
    })
    await world.create('bridgeaccess').with({
      email: 'grace@example.com',
      role: 'editor',
      status: 'pending',
      inviteTokenHash: 'a'.repeat(64),
      inviteExpiresAt: Date.now() + 7 * 24 * 60 * 60 * 1000,
      app: app.id,
      environment: environment.id,
      project: project.id,
      team: current.teams.genesisTeam.id,
      invitedBy: current.users.genesisUser.id
    })

    await login.withPassword('genesisUser', page, {
      password: current.auth.genesisUserPassword
    })
    await page.resize(1365, 900)
    await page.goto(
      `/projects/${project.slug}/environments/${environment.slug}/apps/${app.slug}/bridge/access`
    )

    await expect(page).toSee('Bridge access')
    await expect(page).toSee('Ada Lovelace')
    await expect(page).toSee('grace@example.com')
    await expect(page).toSee('App-local Bridge is enabled')
    await expect(page).toSee('Public Bridge URL')
    await expect(page).not.toSee('Open in Slipway')
    await expect(page).not.toSee('Slipway instance URL')
    expect(
      await page.script(
        () =>
          window.getComputedStyle(
            document.querySelector('[data-test="public-bridge-url"]')
          ).display
      )
    ).toBe('block')
    expect(page).toHaveNoJavascriptErrors()

    await page.screenshot(path.join(screenshotRoot, 'light.png'), {
      fullPage: true
    })

    await page.raw
      .getByRole('button', { name: 'Manage grace@example.com' })
      .click()
    await expect(page).toSee('Resend invitation')
    await page.screenshot(path.join(screenshotRoot, 'actions.png'), {
      fullPage: true
    })

    await page.raw.getByRole('heading', { name: 'Bridge access' }).click()
    await page.raw.emulateMedia({ colorScheme: 'dark' })
    await page.wait(100)
    await page.screenshot(path.join(screenshotRoot, 'dark.png'), {
      fullPage: true
    })
  }
)
