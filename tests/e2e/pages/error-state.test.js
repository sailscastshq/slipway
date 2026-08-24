const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')

const { test } = require('sounding')

async function stubUpdateCheck(page) {
  await page.raw.route('**/api/v1/system/check-update', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ updateAvailable: false })
    })
  })
}

test(
  'Klean Error State announces one dynamic Bosun failure and retries the same database',
  { browser: true, world: 'configured-slipway' },
  async ({ world, login, page, expect }) => {
    const requestedDatabases = []

    await stubUpdateCheck(page)
    await page.raw.route('**/api/v1/bosun/diff?**', async (route) => {
      const database = new URL(route.request().url()).searchParams.get(
        'database'
      )
      requestedDatabases.push(database)

      if (requestedDatabases.length < 3) {
        await route.fulfill({
          status: 503,
          contentType: 'application/json',
          body: JSON.stringify({ error: 'Schema service unavailable.' })
        })
        return
      }

      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          modelCount: 1,
          hasPendingChanges: false,
          statements: []
        })
      })
    })

    await login.withPassword('genesisUser', page, {
      password: world.current.auth.genesisUserPassword
    })
    await page.raw.waitForURL((url) => !url.pathname.startsWith('/login'), {
      timeout: 10000
    })
    await page.resize(1440, 900)
    await page.goto('/bosun')

    const firstDiff = page.raw.waitForResponse((response) =>
      response.url().includes('/api/v1/bosun/diff?')
    )
    await page.raw.getByRole('tab', { name: 'Migrate' }).click()
    await firstDiff

    const panel = page.raw.getByRole('tabpanel', { name: 'Migrate' })
    let alert = panel.getByRole('alert')
    await expect(alert).toHaveAttribute('data-slot', 'error-state')
    await expect(
      alert.getByRole('heading', { name: 'Migrate diff failed' })
    ).toBeVisible()
    await expect(alert).toContainText('Schema service unavailable.')

    const secondDiff = page.raw.waitForResponse((response) => {
      const url = new URL(response.url())
      return (
        url.pathname === '/api/v1/bosun/diff' &&
        url.searchParams.get('database') === 'observability'
      )
    })
    await panel.getByRole('button', { name: 'observability' }).click()
    await secondDiff
    alert = panel.getByRole('alert')
    await expect(alert).toBeVisible()

    const retryDiff = page.raw.waitForResponse((response) => {
      const url = new URL(response.url())
      return (
        url.pathname === '/api/v1/bosun/diff' &&
        url.searchParams.get('database') === 'observability'
      )
    })
    await alert.getByRole('button', { name: 'Try again' }).click()
    await retryDiff
    await expect(alert).not.toBeVisible()
    await expect(panel.getByText('No pending schema changes')).toBeVisible()
    expect(requestedDatabases).toEqual([
      'app',
      'observability',
      'observability'
    ])

    expect(page).toHaveNoJavascriptErrors()
  }
)

test(
  'Klean Error State keeps Bridge recovery native and quiet on initial render',
  {
    browser: true,
    world: {
      name: 'configured-slipway',
      context: {
        deploymentTarget: {
          slug: 'bridge-error-state',
          name: 'Bridge Error State'
        }
      }
    }
  },
  async ({ sails, world, login, page, expect }) => {
    const current = world.current
    const originalIntrospectModels = sails.helpers.bridge.introspectModels
    let shouldFail = true

    await sails.models.app
      .updateOne({ id: current.apps.web.id })
      .set({ status: 'running', containerName: 'bridge-error-state-web' })
    sails.helpers.bridge.introspectModels = async () =>
      shouldFail
        ? { error: 'Bridge could not inspect this application.' }
        : { models: {}, dashboards: {} }

    try {
      await stubUpdateCheck(page)
      await login.withPassword('genesisUser', page, {
        password: current.auth.genesisUserPassword
      })
      await page.raw.waitForURL((url) => !url.pathname.startsWith('/login'), {
        timeout: 10000
      })
      const bridgePath = `/projects/${current.projects.deploymentTarget.slug}/environments/${current.environments.production.slug}/bridge`
      await page.goto(bridgePath)

      const region = page.raw.getByRole('region', {
        name: 'Failed to load models'
      })
      await expect(region).toHaveAttribute('data-slot', 'error-state')
      await expect(region).not.toHaveAttribute('role', 'alert')
      await expect(region).toContainText(
        'Bridge could not inspect this application.'
      )

      shouldFail = false
      await region.getByRole('button', { name: 'Retry' }).click()
      await expect(region).not.toBeVisible()
      await expect(page.raw.getByText('No resources available')).toBeVisible()

      expect(page).toHaveNoJavascriptErrors()
    } finally {
      sails.helpers.bridge.introspectModels = originalIntrospectModels
    }
  }
)

test(
  'Klean Error State hides private content paths and retries without losing context',
  {
    browser: true,
    world: {
      name: 'configured-slipway',
      context: {
        deploymentTarget: {
          slug: 'content-error-state',
          name: 'Content Error State'
        }
      }
    }
  },
  async ({ sails, world, login, page, expect }) => {
    const current = world.current
    const originalAppsDir = sails.config.custom.slipwayAppsDir
    const tempRoot = fs.mkdtempSync(
      path.join(os.tmpdir(), 'slipway-content-error-state-')
    )
    const projectRoot = path.join(
      tempRoot,
      current.projects.deploymentTarget.slug
    )
    const brokenContentPath = path.join(projectRoot, 'broken-content')

    fs.mkdirSync(projectRoot, { recursive: true })
    fs.writeFileSync(brokenContentPath, 'This should be a directory.\n')
    sails.config.custom.slipwayAppsDir = tempRoot
    await sails.models.environment
      .updateOne({ id: current.environments.production.id })
      .set({
        features: {
          'sails-content': {
            version: '1.0.0',
            contentDir: 'broken-content'
          }
        }
      })

    try {
      await stubUpdateCheck(page)
      await login.withPassword('genesisUser', page, {
        password: current.auth.genesisUserPassword
      })
      await page.raw.waitForURL((url) => !url.pathname.startsWith('/login'), {
        timeout: 10000
      })
      const contentPath = `/projects/${current.projects.deploymentTarget.slug}/content?appSlug=${current.apps.web.slug}`
      await page.goto(contentPath)

      const region = page.raw.getByRole('region', {
        name: 'Content collections could not load'
      })
      await expect(region).toHaveAttribute('data-slot', 'error-state')
      await expect(region).toContainText(
        'Slipway could not read this app’s content collections.'
      )
      await expect(region).not.toContainText(tempRoot)

      fs.rmSync(brokenContentPath)
      fs.mkdirSync(brokenContentPath)
      await region.getByRole('button', { name: 'Try again' }).click()
      await expect(region).not.toBeVisible()
      await expect(
        page.raw.getByRole('heading', { name: 'No content collections found' })
      ).toBeVisible()

      expect(page).toHaveNoJavascriptErrors()
    } finally {
      sails.config.custom.slipwayAppsDir = originalAppsDir
      fs.rmSync(tempRoot, { recursive: true, force: true })
    }
  }
)
