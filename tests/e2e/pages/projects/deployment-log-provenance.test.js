const { test } = require('sounding')
const path = require('node:path')
const fs = require('node:fs')
const events = require('../../../../api/lib/deployment-log-events')
test(
  'authenticated deployment log API and page preserve only server-owned public coordinates',
  {
    browser: true,
    transport: 'http',
    world: {
      name: 'configured-slipway',
      context: {
        cliActor: true,
        deploymentTarget: {
          slug: 'deployment-provenance-ui',
          name: 'Deployment provenance'
        }
      }
    }
  },
  async ({ sails, world, request, login, page, expect }) => {
    const values = {
      APP_NAME: 'acaciaco',
      NODE_ENV: 'production',
      BASE_URL: 'https://acaciaco.example',
      API_TOKEN: 'synthetic-ui-credential-canary'
    }
    const metadata = sails.helpers.configuration.normalizeEnvVarMetadata(values)
    await sails.models.app
      .updateOne(world.current.apps.web.id)
      .set({ secureEnvVars: values, envVarMetadata: metadata })
    sails.hooks.secrets.remember({ envVars: values, envVarMetadata: metadata })
    const deployment = await world.create('deployment').with({
      environment: world.current.environments.production.id,
      app: world.current.apps.web.id,
      status: 'running'
    })
    const name = `slipway-acaciaco-production-acaciaco-example-${deployment.id}`
    await Deployment.appendDeployLog(deployment.id, events.containerStart(name))
    await Deployment.appendDeployLog(
      deployment.id,
      events.healthPassed(name, 1337, '/health', 200, 1)
    )
    await Deployment.appendDeployLog(
      deployment.id,
      events.accessUrl('URL', 'https://acaciaco.example')
    )
    await Deployment.appendDeployLog(
      deployment.id,
      'Docker stdout: acaciaco production synthetic-ui-credential-canary\n'
    )
    const row = await Deployment.findOne(deployment.id)
    const rendered = sails.hooks.secrets.renderDeploymentLog(
      row.deployLogs,
      deployment.id
    )
    const response = await request
      .as('genesisUser')
      .get(`/api/v1/deployments/${deployment.id}/logs`)
    expect(response).toHaveStatus(200)
    expect(response).toHaveJsonPath('deployLogs', rendered)
    await login.withPassword('genesisUser', page, {
      password: world.current.auth.genesisUserPassword
    })
    const url = `/projects/${world.current.projects.deploymentTarget.slug}/deployments/${deployment.id}`
    await page.goto(url)
    await expect(page).toSee(`Starting container: ${name}`)
    await expect(page).toSee('https://acaciaco.example')
    await expect(page).toSee('Docker stdout: [REDACTED] [REDACTED] [REDACTED]')
    await page.goto(url)
    await expect(page).toSee(`Starting container: ${name}`)
    const root = path.resolve('.tmp/screenshots/deployment-log-provenance')
    fs.mkdirSync(root, { recursive: true })
    await page.screenshot(path.join(root, 'desktop.png'), { fullPage: true })
    await page.raw.setViewportSize({ width: 390, height: 844 })
    await page.screenshot(path.join(root, 'mobile.png'), { fullPage: true })
  }
)
