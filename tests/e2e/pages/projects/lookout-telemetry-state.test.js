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
    const screenshotRoot = path.resolve(
      '.tmp/screenshots/issue-376-lookout-runtime-state'
    )
    fs.mkdirSync(screenshotRoot, { recursive: true })

    await sails.models.app.updateOne({ id: app.id }).set({
      currentDeployment: deployment.id,
      status: 'running'
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

    await login.withPassword('genesisUser', page, {
      password: current.auth.genesisUserPassword
    })
    await page.resize(1440, 900)
    await page.inLightMode()
    const lookoutPath = `/projects/${project.slug}/environments/${environment.slug}/lookout`
    await page.goto(lookoutPath)

    await expect(page).toSee('Connected — waiting for traffic')
    await expect(page).not.toSee('Installation')
    expect(page).toHaveNoJavascriptErrors()
    await page.screenshot(path.join(screenshotRoot, 'connected-quiet.png'), {
      fullPage: true,
      animations: 'disabled'
    })

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
