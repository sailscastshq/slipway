const { test } = require('sounding')

const RESULT = {
  success: true,
  value: { updated: true },
  logs: [],
  output: '{\n  "updated": true\n}',
  error: null,
  durationMs: 18,
  truncated: false,
  status: 'success',
  outputBytes: 21,
  logsPartial: false
}

test(
  'Helm makes its production target obvious and requires a short-lived write arm',
  {
    browser: true,
    world: {
      name: 'configured-slipway',
      context: {
        deploymentTarget: {
          slug: 'helm-production-guard',
          name: 'Helm Production Guard'
        }
      }
    }
  },
  async ({ sails, world, login, page, expect }) => {
    const current = world.current
    const project = current.projects.deploymentTarget
    const environment = current.environments.production
    const app = current.apps.web
    const originalExecute = sails.helpers.helm.executeInContainer
    const deployment = await sails.models.deployment
      .create({
        status: 'running',
        gitCommit: '274acbd91324beef',
        gitBranch: 'main',
        imageName: 'slipway/helm-production-guard:274acbd',
        environment: environment.id,
        app: app.id,
        triggeredBy: current.users.genesisUser.id
      })
      .fetch()

    await sails.models.app.updateOne({ id: app.id }).set({
      status: 'running',
      containerName: 'helm-production-guard-web',
      currentDeployment: deployment.id
    })
    sails.helpers.helm.executeInContainer = async () => RESULT

    try {
      const updateCheckFinished = page.raw.waitForResponse(
        '**/api/v1/system/check-update'
      )
      await login.withPassword('genesisUser', page, {
        password: current.auth.genesisUserPassword
      })
      await updateCheckFinished
      await page.raw
        .context()
        .grantPermissions(['clipboard-read', 'clipboard-write'])
      await page.resize(1440, 900)
      await page.inLightMode()
      await page.goto(
        `/projects/${project.slug}/environments/${environment.slug}/helm`
      )

      expect(page).toSee('production')
      expect(page).toSee('web')
      expect(await page.raw.locator('[data-test="helm-target"]').count()).toBe(
        0
      )

      await page.fill(
        '@helm-editor',
        "await Creator.updateOne({ id: 1 }).set({ email: 'grace@example.com' })"
      )
      await page.click('@helm-run')
      await page.wait('@helm-write-guard')
      expect(page).toSee('Arm production writes?')
      expect(page).toSee('Update one record')
      expect(page).toSee('safety heuristic')
      await page.wait(200)
      await page.screenshot('.tmp/issue-274-write-warning-light.png')

      await page.inDarkMode()
      await page.click('@helm-arm-writes')
      await page.wait('@helm-writes-armed')
      await page.raw
        .locator('[data-test="helm-write-guard"]')
        .waitFor({ state: 'hidden' })
      await page.wait(150)
      expect(page).toSee('Run write')
      await page.screenshot('.tmp/issue-274-writes-armed-dark.png')

      await page.click('@helm-run')
      await page.wait('@helm-output')
      expect(page).toSee('updated')
      expect(
        await page.raw.locator('[data-test="helm-writes-armed"]').count()
      ).toBe(0)

      await page.click('@helm-result-actions-trigger')
      await page.click('@helm-result-actions-copy-diagnostics')
      const diagnostics = JSON.parse(
        await page.script(() => navigator.clipboard.readText())
      )
      expect(diagnostics.target.environment.isProduction).toBe(true)
      expect(diagnostics.target.app.slug).toBe(app.slug)
      expect(diagnostics.target.container).toBe('helm-production-guard-web')
      expect(diagnostics.execution.status).toBe('success')
      expect(JSON.stringify(diagnostics).includes('grace@example.com')).toBe(
        false
      )

      await page.inLightMode()
      await page.goto('/settings/audit-log?group=helm')
      await page.wait('@audit-events')
      expect(page).toSee('Ran Helm')
      expect(page).toSee('Armed Helm writes')
      await page.screenshot('.tmp/issue-274-audit-light.png')

      await page.fill('@audit-search', 'armed')
      await page.wait(350)
      await page.wait('@audit-events')
      expect(page).toSee('Armed Helm writes')
      await page.inDarkMode()
      await page.screenshot('.tmp/issue-274-audit-search-dark.png')
      expect(page).toHaveNoSmoke()
    } finally {
      sails.helpers.helm.executeInContainer = originalExecute
    }
  }
)
