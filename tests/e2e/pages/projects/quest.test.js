const { test } = require('sounding')

test(
  'Quest shows bounded legacy events and warnings without inventing runs on request failures',
  {
    browser: true,
    world: {
      name: 'configured-slipway',
      context: { deploymentTarget: { slug: 'quest-history-ui' } }
    }
  },
  async ({ sails, world, login, page, expect }) => {
    const current = world.current
    const environment = current.environments.production.id
    await sails.models.environment.updateOne({ id: environment }).set({
      features: { 'sails-quest': { scripts: [{ name: 'synthetic-index' }] } }
    })
    await sails.models.app.updateOne({ id: current.apps.web.id }).set({
      status: 'running',
      containerName: 'never-execute-this-synthetic-container'
    })
    const now = Date.now()
    await sails.models.telemetrymetric.createEach([
      {
        name: 'quest.job.start',
        value: 0,
        recordedAt: now - 30,
        environment,
        attributes: { jobName: 'synthetic-index' }
      },
      {
        name: 'quest.job.complete',
        value: 12,
        recordedAt: now - 20,
        environment,
        attributes: { jobName: 'synthetic-index' }
      },
      {
        name: 'quest.job.error',
        value: 13,
        recordedAt: now - 10,
        environment,
        attributes: {
          jobName: 'synthetic-index',
          error: 'scheduled synthetic diagnostic'
        }
      }
    ])
    // Never contact the legacy discovery runtime or run a real script.
    await page.raw.route('**/quest/stream', (route) =>
      route.fulfill({ status: 204 })
    )
    let requests = 0
    let mode = 'complete'
    await page.raw.route('**/quest/jobs/synthetic-index/run', async (route) => {
      requests++
      if (mode === 'http') {
        return route.fulfill({
          status: 403,
          json: { success: true, exitCode: 0 }
        })
      }
      if (mode === 'transport') return route.abort('failed')
      if (mode === 'invalid')
        return route.fulfill({
          status: 200,
          contentType: 'text/html',
          body: '<html>Sign in</html>'
        })
      await sails.models.telemetrymetric.create({
        name: 'quest.job.completed',
        value: 15,
        recordedAt: Date.now(),
        environment,
        attributes: {
          jobName: 'synthetic-index',
          trigger: 'manual',
          stdout: '{"processed":0}',
          stderr: 'manual synthetic warning'
        }
      })
      return route.fulfill({
        json: {
          success: true,
          exitCode: 0,
          output: '{"processed":0}',
          stderr: 'manual synthetic warning'
        }
      })
    })
    await login.withPassword('genesisUser', page, {
      password: current.auth.genesisUserPassword
    })
    await page.goto('/projects/quest-history-ui/quest')
    const total = page.raw.locator('[data-test="quest-event-total"]')
    const output = page.raw.locator(
      '[data-test="quest-output-synthetic-index"]'
    )
    const run = page.raw.getByRole('button', {
      name: 'Run synthetic-index now',
      exact: true
    })
    await expect(total).toHaveText('2')
    await expect(
      page.raw.locator('[data-test="quest-history-scope"]')
    ).toContainText('up to 500 telemetry events from the last 7 days')
    await page.raw
      .getByRole('button', { name: /synthetic-index/ })
      .filter({ has: page.raw.locator('h3') })
      .click()
    await page.raw
      .getByRole('button', {
        name: 'scheduled synthetic diagnostic',
        exact: true
      })
      .click()
    await expect(
      page.raw
        .locator('pre')
        .filter({ hasText: 'scheduled synthetic diagnostic' })
    ).toBeVisible()
    expect(new URL(page.raw.url()).searchParams.has('run')).toBe(false)

    // An unchanged snapshot must not collapse the diagnostic being read.
    const refreshed = page.raw.waitForResponse(
      (response) =>
        new URL(response.url()).pathname ===
          '/projects/quest-history-ui/quest' &&
        response.request().headers()['x-inertia'] === 'true'
    )
    await page.raw
      .getByRole('button', { name: 'Refresh scripts', exact: true })
      .click()
    await refreshed
    await expect(
      page.raw
        .locator('pre')
        .filter({ hasText: 'scheduled synthetic diagnostic' })
    ).toBeVisible()

    await run.focus()
    await page.raw.keyboard.press('Enter')
    await expect(output).toContainText('Completed')
    await expect(output).toContainText('manual synthetic warning')
    // The persisted event is counted once after the Inertia refresh.
    await expect(total).toHaveText('3')
    expect(requests).toBe(1)
    await expect(
      page.raw
        .locator('pre')
        .filter({ hasText: 'scheduled synthetic diagnostic' })
    ).toBeVisible()

    for (const [width, colorScheme] of [
      [1280, 'light'],
      [1280, 'dark'],
      [390, 'light'],
      [390, 'dark']
    ]) {
      await page.raw.setViewportSize({ width, height: 900 })
      await page.raw.emulateMedia({ colorScheme })
      await expect(output).toContainText('manual synthetic warning')
      await expect(run).toBeVisible()
    }

    for (const failure of ['http', 'transport', 'invalid']) {
      mode = failure
      await run.click()
      await expect(output).toContainText(
        failure === 'http' ? 'Request failed' : 'Execution outcome unconfirmed'
      )
      await expect(output).toContainText('Check history before retrying')
      await expect(output).not.toContainText('Failed (exit')
      await expect(total).toHaveText('3')
    }
    expect(requests).toBe(4)
    await page.raw
      .getByRole('button', {
        name: 'Dismiss output for synthetic-index',
        exact: true
      })
      .click()
    await expect(output).toHaveCount(0)
    await page.raw.reload()
    await expect(total).toHaveText('3')
    expect(requests).toBe(4)
  }
)
