const fs = require('node:fs')
const path = require('node:path')
const { test } = require('sounding')

test(
  'Lookout shows quiet and stale runtime states without falling back to setup',
  {
    browser: true,
    world: {
      name: 'configured-slipway',
      context: {
        deploymentTarget: {
          slug: 'lookout-runtime-state',
          name: 'Lookout Runtime State'
        }
      }
    }
  },
  async ({ sails, world, login, page, expect }) => {
    const current = world.current
    const project = current.projects.deploymentTarget
    const environment = current.environments.production
    const app = current.apps.web
    const deployment = await sails.models.deployment
      .create({
        status: 'running',
        triggerType: 'manual',
        startedAt: Date.now() - 60_000,
        environment: environment.id,
        app: app.id
      })
      .fetch()
    const containerName = 'lookout-runtime-state-web'
    const screenshotRoot = path.resolve(
      '.tmp/screenshots/issue-376-lookout-runtime-state'
    )
    fs.mkdirSync(screenshotRoot, { recursive: true })

    await sails.models.app.updateOne({ id: app.id }).set({
      currentDeployment: deployment.id,
      status: 'running',
      containerName
    })
    await sails.models.environment.updateOne({ id: environment.id }).set({
      features: { 'sails-hook-slipway': { version: '^0.0.9' } }
    })
    const connection = await sails.models.telemetryconnection
      .create({
        app: String(app.id),
        environment: String(environment.id),
        deployment: String(deployment.id),
        hookVersion: '0.0.9',
        protocolVersion: 1,
        capabilities: { requests: true, exceptions: true, queries: true },
        enabled: true,
        startedAt: Date.now() - 60_000,
        lastSeenAt: Date.now()
      })
      .fetch()
    const recordedAt = Date.now()
    await sails.models.containermetric.createEach(
      [
        { cpuPercent: 12, memoryPercent: 31 },
        { cpuPercent: 27, memoryPercent: 39 },
        { cpuPercent: 19, memoryPercent: 36 },
        { cpuPercent: 44, memoryPercent: 48 }
      ].map((metric, index) => ({
        containerName,
        containerType: 'app',
        cpuPercent: metric.cpuPercent,
        memoryUsage: (256 + index * 24) * 1024 * 1024,
        memoryLimit: 1024 * 1024 * 1024,
        memoryPercent: metric.memoryPercent,
        netIO: `${index + 1}MB / ${index + 2}MB`,
        blockIO: `${index + 3}MB / ${index + 4}MB`,
        pids: 12 + index,
        recordedAt: recordedAt - (3 - index) * 10 * 60_000,
        environment: environment.id,
        app: app.id
      }))
    )

    await login.withPassword('genesisUser', page, {
      password: current.auth.genesisUserPassword
    })
    await page.resize(1440, 900)
    await page.inLightMode()
    const lookoutPath = `/projects/${project.slug}/environments/${environment.slug}/lookout`
    await page.goto(lookoutPath)

    await expect(page).toSee('Connected — waiting for traffic')
    await expect(page).not.toSee('Installation')
    await expect(page.raw.locator('[data-slot="sparkline"]')).toHaveCount(2)
    await expect(
      page.raw.locator('[data-slot="sparkline"]').first()
    ).toHaveAttribute('aria-hidden', 'true')
    await page.raw
      .locator(
        `[data-test="lookout-container"][data-container="${containerName}"]`
      )
      .click()
    const lineCharts = page.raw.locator('[data-slot="line-chart"]')
    await expect(lineCharts).toHaveCount(2, { timeout: 15_000 })
    await page.raw.waitForTimeout(250)
    await expect(page).toSee('24-Hour History')
    await page.raw
      .context()
      .grantPermissions(['clipboard-read', 'clipboard-write'])
    await page.raw.locator('[data-test="copy-performance-diagnostic"]').click()
    const diagnostic = JSON.parse(
      await page.raw.evaluate(() => navigator.clipboard.readText())
    )
    expect(diagnostic.scope.containerName).toBe(containerName)
    expect(diagnostic.memory.latestUsageMiB).toBe(328)
    expect(diagnostic.memory.dockerLimitMiB).toBe(1024)
    const chartPoints = page.raw.locator('[data-slot="line-chart-hit"]')
    await expect(chartPoints).toHaveCount(8)
    await chartPoints.first().focus()
    await expect(chartPoints.first()).toBeFocused()
    await expect(chartPoints.first()).toHaveAttribute(
      'aria-label',
      /Inspect .*12\.0%/
    )
    expect(page).toHaveNoJavascriptErrors()
    await page.screenshot(path.join(screenshotRoot, 'connected-quiet.png'), {
      fullPage: true,
      animations: 'disabled'
    })
    await page.inDarkMode()
    await page.screenshot(
      path.join(screenshotRoot, 'connected-quiet-dark.png'),
      {
        fullPage: true,
        animations: 'disabled'
      }
    )
    await page.resize(390, 844)
    const mobileChartBoxes = await lineCharts.evaluateAll((charts) =>
      charts.map((chart) => {
        const box = chart.getBoundingClientRect()
        return { left: box.left, right: box.right }
      })
    )
    expect(
      mobileChartBoxes.every(({ left, right }) => left >= 0 && right <= 390)
    ).toBe(true)
    await page.screenshot(
      path.join(screenshotRoot, 'connected-quiet-mobile-dark.png'),
      {
        fullPage: true,
        animations: 'disabled'
      }
    )
    await page.inLightMode()
    await page.screenshot(
      path.join(screenshotRoot, 'connected-quiet-mobile.png'),
      {
        fullPage: true,
        animations: 'disabled'
      }
    )
    await page.resize(1440, 900)

    await sails.models.telemetryconnection
      .updateOne({ id: connection.id })
      .set({ lastSeenAt: Date.now() - 10 * 60_000 })
    await page.raw.reload()

    await expect(page).toSee('Telemetry connection is stale')
    await page.screenshot(path.join(screenshotRoot, 'stale.png'), {
      fullPage: true,
      animations: 'disabled'
    })
  }
)

test(
  'Lookout makes rejected telemetry visible',
  {
    browser: true,
    world: {
      name: 'configured-slipway',
      context: { deploymentTarget: { slug: 'ingestion-feedback' } }
    }
  },
  async ({ sails, world, login, page, expect }) => {
    const environment = world.current.environments.production
    const app = world.current.apps.web
    const deployment = await sails.models.deployment
      .create({
        status: 'running',
        triggerType: 'manual',
        startedAt: Date.now() - 60_000,
        environment: environment.id,
        app: app.id
      })
      .fetch()
    await sails.models.app.updateOne({ id: app.id }).set({
      currentDeployment: deployment.id,
      status: 'running',
      containerName: 'lookout-ingestion-feedback-web'
    })
    await sails.models.environment.updateOne({ id: environment.id }).set({
      features: { 'sails-hook-slipway': { version: '^0.0.11' } }
    })
    await sails.models.telemetryconnection.create({
      app: String(app.id),
      environment: String(environment.id),
      deployment: String(deployment.id),
      hookVersion: '0.0.11',
      protocolVersion: 1,
      capabilities: { requests: true, exceptions: true, queries: true },
      enabled: true,
      startedAt: Date.now() - 60_000,
      lastSeenAt: Date.now()
    })
    await sails.models.telemetryingestionbudget.create({
      environment: String(environment.id),
      rejectedEvents: 250,
      rejectedRequests: 2
    })
    await login.withPassword('genesisUser', page, {
      password: world.current.auth.genesisUserPassword
    })
    await page.goto('/projects/ingestion-feedback/lookout')
    const ingestionStatus = page.raw.locator(
      '[data-test="lookout-ingestion-status"]'
    )
    await expect(ingestionStatus).toHaveAttribute('role', 'status')
    await expect(ingestionStatus).toContainText(
      '250 events rejected across 2 requests'
    )
    await expect(page).toSee('Connected — waiting for traffic')
    fs.mkdirSync('.github/screenshots/audit-telemetry-limits', {
      recursive: true
    })
    await page.screenshot(
      '.github/screenshots/audit-telemetry-limits/rejections.png',
      { fullPage: true, animations: 'disabled' }
    )
    await page.inDarkMode()
    await page.screenshot('.tmp/lookout-rejections-dark.png', {
      fullPage: true,
      animations: 'disabled'
    })
    await ingestionStatus.locator('summary').focus()
    await ingestionStatus.locator('summary').press('Enter')
    await expect(ingestionStatus).toContainText(
      "Check the app's telemetry payloads and per-minute limits."
    )
  }
)
