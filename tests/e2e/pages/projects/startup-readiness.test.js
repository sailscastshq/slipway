const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const { test } = require('sounding')
const events = require('../../../../api/lib/deployment-log-events')

test(
  'startup settings and synthetic slow, crash, and binding outcomes remain readable with credentials masked',
  {
    browser: true,
    transport: 'http',
    world: {
      name: 'configured-slipway',
      context: {
        cliActor: true,
        deploymentTarget: { slug: 'startup-demo', name: 'Startup demo' }
      }
    }
  },
  async ({ sails, world, request, login, page, expect }) => {
    const project = world.current.projects.deploymentTarget
    const environment = world.current.environments.production
    const app = world.current.apps.web
    const directory = path.resolve('.tmp/screenshots/startup-readiness')
    fs.mkdirSync(directory, { recursive: true })
    await login.withPassword('genesisUser', page, {
      password: world.current.auth.genesisUserPassword
    })
    await page.goto(
      `/projects/${project.slug}/environments/${environment.slug}/apps/${app.slug}/settings`
    )
    await expect(page).toSee('Startup window (seconds)')
    assert.equal(await page.raw.locator('#startup-window').inputValue(), '120')
    await page.screenshot(path.join(directory, 'settings-desktop.png'), {
      fullPage: true
    })
    await page.raw.setViewportSize({ width: 390, height: 844 })
    await page.screenshot(path.join(directory, 'settings-mobile.png'), {
      fullPage: true
    })
    await page.raw.setViewportSize({ width: 1440, height: 1050 })
    const result = await request
      .as('genesisUser')
      .patch(
        `/api/v1/projects/${project.slug}/environments/${environment.slug}/apps/${app.slug}`,
        {
          resourceLimits: {
            cpus: app.resourceLimits.cpus,
            memory: app.resourceLimits.memory,
            startupTimeoutSeconds: 180
          }
        }
      )
    expect(result).toHaveStatus(200)
    assert.equal(
      (await App.findOne(app.id)).resourceLimits.startupTimeoutSeconds,
      180
    )
    const invalid = await request
      .as('genesisUser')
      .patch(
        `/api/v1/projects/${project.slug}/environments/${environment.slug}/apps/${app.slug}`,
        {
          resourceLimits: {
            cpus: app.resourceLimits.cpus,
            memory: app.resourceLimits.memory,
            startupTimeoutSeconds: 601
          }
        }
      )
    expect(invalid).toHaveStatus(400)
    assert.equal(
      (await App.findOne(app.id)).resourceLimits.startupTimeoutSeconds,
      180
    )
    sails.hooks.secrets.remember({
      env: { API_TOKEN: 'synthetic-ui-credential-770' }
    })
    for (const scenario of [
      {
        name: 'slow-start',
        status: 'running',
        duration: 80000,
        errorMessage: null,
        logs:
          'Synthetic fixture: slow startup succeeds within its 120s window.\n' +
          events.healthPoll('candidate-synthetic', 1337, '/health', 120) +
          'Startup still waiting after 60s: HTTP 503\n' +
          events.healthPassed('candidate-synthetic', 1337, '/health', 204, 41) +
          'Deployment complete.\n'
      },
      {
        name: 'crash',
        status: 'failed',
        duration: 1000,
        errorMessage:
          'Synthetic fixture: candidate exited during startup (exit code 1).',
        logs: 'Synthetic fixture: early candidate crash.\nERROR [health check]: Candidate stopped during startup: state exited, exit code 1.\n--- Startup diagnostics ---\nContainer state: exited; exit code: 1; OOM killed: no\n--- Startup stdout ---\nLoading application configuration...\n--- Startup stderr ---\nStartup error: invalid synthetic configuration\nAPI_TOKEN=synthetic-ui-credential-770\n'
      },
      {
        name: 'binding',
        status: 'failed',
        duration: 1000,
        errorMessage: 'Synthetic fixture: host port is already allocated.',
        logs: 'Synthetic fixture: host binding failure.\nERROR [starting container]: port is already allocated\n--- Startup diagnostics ---\nContainer state: created; exit code: 0; OOM killed: no\nContainer error: address already in use\nNo startup output was available.\n'
      }
    ]) {
      const deployment = await world.create('deployment').with({
        environment: environment.id,
        app: app.id,
        status: scenario.status,
        startedAt: Date.now() - scenario.duration,
        finishedAt: Date.now(),
        errorMessage: scenario.errorMessage
      })
      await Deployment.appendDeployLog(deployment.id, scenario.logs)
      const stored = await Deployment.findOne(deployment.id)
      assert(!stored.deployLogs.includes('synthetic-ui-credential-770'))
      await page.goto(`/projects/${project.slug}/deployments/${deployment.id}`)
      await expect(page).toSee('Synthetic fixture:')
      if (scenario.name === 'crash') {
        await expect(page).toSee('Startup stdout')
        await expect(page).toSee('Startup stderr')
        await expect(page).toSee('API_TOKEN=[REDACTED]')
      }
      await page.screenshot(
        path.join(directory, `${scenario.name}-desktop.png`),
        { fullPage: true }
      )
      if (scenario.name === 'crash') {
        await page.raw.setViewportSize({ width: 390, height: 844 })
        await page.screenshot(path.join(directory, 'crash-mobile.png'), {
          fullPage: true
        })
        await page.raw.setViewportSize({ width: 1440, height: 1050 })
      }
    }
  }
)
