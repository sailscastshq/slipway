const fs = require('node:fs')
const path = require('node:path')
const { test } = require('sounding')

test(
  'app-domain Bridge renders its own responsive workspace shell',
  {
    browser: true,
    world: {
      name: 'configured-slipway',
      context: {
        deploymentTarget: {
          slug: 'bridge-workspace-ui',
          name: 'Bridge Workspace UI'
        }
      }
    }
  },
  async ({ sails, world, page, expect }) => {
    const current = world.current
    const environment = current.environments.production
    const project = current.projects.deploymentTarget
    const app = current.apps.web
    const originalIntrospectModels = sails.helpers.bridge.introspectModels
    const originalBuildSailsWrapper = sails.helpers.bridge.buildSailsWrapper
    const originalExecuteInContainer = sails.helpers.bridge.executeInContainer
    const screenshotRoot = path.resolve(
      '.tmp/screenshots/issue-390-bridge-workspace'
    )
    fs.mkdirSync(screenshotRoot, { recursive: true })

    const contract = await sails.helpers.bridge.normalizeResourceContract.with({
      models: workspaceModels(),
      config: workspaceConfig()
    })

    try {
      await sails.models.environment.updateOne({ id: environment.id }).set({
        domain: 'academy.example.com'
      })
      await sails.models.app.updateOne({ id: app.id }).set({
        name: 'Sailscasts',
        routePath: '/',
        bridgeEnabled: true,
        status: 'running',
        containerName: 'bridge-workspace-ui-web'
      })
      const secret = await sails.helpers.bridge.ensureAppSecret.with({
        appId: String(app.id),
        rotate: true
      })
      expect(Boolean(secret)).toBe(true)

      const access = await world.create('bridgeaccess').with({
        email: 'kevin@sailscasts.com',
        role: 'administrator',
        status: 'active',
        hostUserId: 'sailscasts-admin',
        hostUserName: 'Kevin Omereshone',
        activatedAt: Date.now(),
        app: app.id,
        environment: environment.id,
        project: project.id,
        team: current.teams.genesisTeam.id,
        invitedBy: current.users.genesisUser.id
      })

      sails.helpers.bridge.introspectModels = async () => ({
        schemaVersion: contract.schemaVersion,
        discover: contract.discover,
        configured: contract.configured,
        models: contract.resources,
        dashboards: contract.dashboards
      })
      sails.helpers.bridge.buildSailsWrapper = async (code) => code
      sails.helpers.bridge.executeInContainer = async (containerName, code) => {
        expect(containerName).toBe('bridge-workspace-ui-web')
        if (code.includes('const decisions = Object.create(null);')) {
          const requests = readEmbeddedValue(code, 'requests')
          const decisions = {}
          for (const request of requests) {
            decisions[request.key] ||= {}
            decisions[request.key][request.action] = true
          }
          return successfulResult(decisions)
        }
        if (code.includes('const dashboard =')) {
          return successfulResult([
            { id: 'users', value: 61 },
            { id: 'courses', value: 5 },
            { id: 'chapters', value: 24 },
            { id: 'lessons', value: 88 },
            { id: 'sales', value: 1, detail: 'Completed purchases' }
          ])
        }
        if (code.includes('const counts = {};')) {
          return successfulResult({
            user: 61,
            course: 5,
            chapter: 24,
            lesson: 88,
            purchase: 1
          })
        }
        return successfulResult({})
      }

      const launchCode = await sails.helpers.bridge.issueLaunchCode.with({
        accessId: String(access.id),
        appId: String(app.id)
      })
      await page.raw.route('**/bridge/_assets/**', async (route) => {
        const assetUrl = new URL(route.request().url())
        assetUrl.pathname = assetUrl.pathname.replace('/bridge/_assets', '')
        await route.continue({ url: assetUrl.toString() })
      })
      await page.raw.context().setExtraHTTPHeaders({
        'x-forwarded-host': 'academy.example.com'
      })
      await page.goto(
        `/bridge/launch?code=${encodeURIComponent(
          launchCode
        )}&hostOrigin=true&hostRoutePath=/`
      )

      const internalBridgePath = `/projects/${project.slug}/environments/${environment.slug}/apps/${app.slug}/bridge`
      await page.resize(1440, 960)
      await page.goto(internalBridgePath)
      await page.wait('@bridge-workspace')

      await expect(page).toSee('Sailscasts')
      await expect(page).toSee('Bridge')
      await expect(page).toSee('Content overview')
      await expect(page).toSee('Courses')
      await expect(page).toSee('Lessons')
      const desktopSidebar = page.raw
        .locator('[data-test="bridge-workspace-sidebar"]')
        .last()
      expect(
        await desktopSidebar
          .locator('[data-test="bridge-resource-link"]')
          .count()
      ).toBe(5)
      expect(
        await desktopSidebar
          .locator('[data-test="bridge-resource-link"][data-resource="course"]')
          .getAttribute('href')
      ).toBe('/bridge/course')
      expect(
        await desktopSidebar.getByText('Content', { exact: true }).count()
      ).toBe(0)
      expect(
        await desktopSidebar.getByText('People', { exact: true }).count()
      ).toBe(0)
      expect(
        await page.raw.locator('[data-test="desktop-team-selector"]').count()
      ).toBe(0)
      expect(
        await page.raw
          .locator('[data-test="bridge-docs-link"]')
          .getAttribute('href')
      ).toBe('https://docs.sailscasts.com/slipway/bridge')
      expect(
        await page.raw
          .locator('[data-test="bridge-page-header"]')
          .getByText('Administrator', { exact: true })
          .count()
      ).toBe(0)

      const actorButton = desktopSidebar.locator(
        '[data-test="bridge-actor-menu-button"]'
      )
      expect(
        (await actorButton.textContent()).includes('kevin@sailscasts.com')
      ).toBe(true)
      await actorButton.click()
      const actorMenu = desktopSidebar.locator(
        '[data-test="bridge-actor-menu"]'
      )
      await actorMenu.waitFor({ state: 'visible' })
      const actorMenuText = await actorMenu.textContent()
      expect(actorMenuText.includes('Role')).toBe(true)
      expect(
        (
          await actorMenu
            .locator('[data-test="bridge-actor-role"]')
            .textContent()
        ).includes('Administrator')
      ).toBe(true)
      expect(
        await actorMenu.getByRole('link', { name: 'Docs' }).getAttribute('href')
      ).toBe('https://docs.sailscasts.com/slipway/bridge')
      expect(
        await actorMenu
          .getByRole('link', { name: 'Sponsor Slipway' })
          .getAttribute('href')
      ).toBe('https://github.com/sponsors/DominusKelvin')
      expect(page).toHaveNoJavascriptErrors()

      await page.screenshot(path.join(screenshotRoot, 'actor-menu.png'), {
        fullPage: true
      })
      await page.raw.locator('[data-test="bridge-page-header"]').click()
      await actorMenu.waitFor({ state: 'hidden' })

      await page.screenshot(path.join(screenshotRoot, 'desktop.png'), {
        fullPage: true
      })

      await page.resize(390, 844)
      await page.raw
        .getByRole('button', { name: 'Open Bridge navigation' })
        .click()
      await page.raw
        .locator('[data-test="bridge-workspace-sidebar"]')
        .first()
        .waitFor({ state: 'visible' })
      await page.raw.waitForTimeout(250)
      await page.screenshot(path.join(screenshotRoot, 'mobile.png'), {
        fullPage: true
      })
      expect(page).toHaveNoJavascriptErrors()
    } finally {
      sails.helpers.bridge.introspectModels = originalIntrospectModels
      sails.helpers.bridge.buildSailsWrapper = originalBuildSailsWrapper
      sails.helpers.bridge.executeInContainer = originalExecuteInContainer
    }
  }
)

function workspaceModels() {
  return Object.fromEntries(
    ['user', 'course', 'chapter', 'lesson', 'purchase'].map((identity) => [
      identity,
      {
        identity,
        globalId: identity.charAt(0).toUpperCase() + identity.slice(1),
        tableName: `${identity}s`,
        primaryKey: 'id',
        attributes: {
          id: { type: 'number', autoIncrement: true },
          title: { type: 'string' },
          createdAt: { type: 'number', autoCreatedAt: true }
        },
        associations: []
      }
    ])
  )
}

function workspaceConfig() {
  return {
    resources: {
      user: { label: 'Users' },
      course: { label: 'Courses' },
      chapter: { label: 'Chapters' },
      lesson: { label: 'Lessons' },
      purchase: { label: 'Sales' }
    },
    dashboard: {
      label: 'Content overview',
      default: true,
      cards: {
        users: { type: 'metric', label: 'Total users', resource: 'user' },
        courses: { type: 'metric', label: 'Courses', resource: 'course' },
        chapters: { type: 'metric', label: 'Chapters', resource: 'chapter' },
        lessons: { type: 'metric', label: 'Lessons', resource: 'lesson' },
        sales: { type: 'metric', label: 'Sales', resource: 'purchase' }
      }
    }
  }
}

function readEmbeddedValue(code, name) {
  const marker = `const ${name} = `
  const start = code.indexOf(marker)
  const end = code.indexOf(';', start)
  return JSON.parse(code.slice(start + marker.length, end))
}

function successfulResult(value) {
  return {
    success: true,
    output: JSON.stringify(value),
    error: null,
    exitCode: 0
  }
}
