const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const { test } = require('sounding')
test(
  'public deployment build and instance identity survives authenticated inspection while synthetic secrets stay masked',
  {
    browser: true,
    transport: 'http',
    world: {
      name: 'configured-slipway',
      context: {
        cliActor: true,
        deploymentTarget: { slug: 'acaciaco', name: 'Acaciaco' }
      }
    }
  },
  async ({ sails, world, request, login, page, expect }) => {
    const project = world.current.projects.deploymentTarget
    const environment = world.current.environments.production
    const hook = sails.hooks.secrets
    const values = {
      APP_NAME: 'acaciaco',
      NODE_ENV: 'production',
      BRAND: 'publicowner',
      API_TOKEN: 'synthetic-ui-secret-768',
      ODD_NAME: 'unknown-ui-canary-768'
    }
    hook.remember({
      envVars: values,
      envVarMetadata:
        sails.helpers.configuration.normalizeEnvVarMetadata(values)
    })
    hook.rememberPublicRecord('project', project)
    hook.rememberPublicRecord('environment', environment)
    hook.rememberPublicRecord('gitrepository', {
      id: 'synthetic-public-repository',
      owner: 'publicownerhq',
      name: 'acaciaco.example',
      fullName: 'publicownerhq/acaciaco.example'
    })
    const deployment = await world.create('deployment').with({
      environment: environment.id,
      app: world.current.apps.web.id,
      status: 'failed',
      startedAt: Date.now() - 35000,
      finishedAt: Date.now(),
      errorMessage:
        'Synthetic fixture: app health check failed; identifiers remain readable.'
    })
    const build =
      'Refreshing source from publicownerhq/acaciaco.example (main)...\nCloning git@github.com:publicownerhq/acaciaco.example.git (branch: main)...\n#12 naming to docker.io/slipway/acaciaco-production-acaciaco-example:123 done\n.tmp/public/images/blog/introducing-acaciaco.jpg 47.0 kB\nCredentials: synthetic-ui-secret-768 unknown-ui-canary-768\n'
    await Deployment.appendBuildLog(deployment.id, build)
    const instanceLine =
      'Running container: slipway-acaciaco-production-acaciaco-example-123'
    await Deployment.appendDeployLog(
      deployment.id,
      hook.protect(instanceLine) + '\n'
    )
    const response = await request
      .as('genesisUser')
      .get(`/api/v1/deployments/${deployment.id}/logs`)
    expect(response).toHaveStatus(200)
    const row = await Deployment.findOne(deployment.id)
    assert.match(row.buildLogs, /publicownerhq\/acaciaco.example/)
    assert.match(row.buildLogs, /introducing-acaciaco.jpg/)
    assert.doesNotMatch(
      row.buildLogs,
      /synthetic-ui-secret-768|unknown-ui-canary-768/
    )
    expect(response).toHaveJsonPath('buildLogs', row.buildLogs)
    await login.withPassword('genesisUser', page, {
      password: world.current.auth.genesisUserPassword
    })
    const url = `/projects/${project.slug}/deployments/${deployment.id}`
    await page.goto(url)
    await expect(page).toSee('publicownerhq/acaciaco.example')
    await expect(page).toSee('introducing-acaciaco.jpg')
    await expect(page).toSee(instanceLine)
    await expect(page).toSee('Credentials: [REDACTED] [REDACTED]')
    await page.goto(url)
    await expect(page).toSee('introducing-acaciaco.jpg')
    const directory = path.resolve('.tmp/screenshots/public-deployment-logs')
    fs.mkdirSync(directory, { recursive: true })
    await page.screenshot(path.join(directory, 'desktop.png'), {
      fullPage: true
    })
    await page.raw.setViewportSize({ width: 390, height: 844 })
    await page.screenshot(path.join(directory, 'mobile.png'), {
      fullPage: true
    })
  }
)
