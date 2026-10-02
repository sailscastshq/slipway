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
    await page.raw.waitForURL('**/')
    await expect(
      page.raw.getByRole('link', { name: 'quest-history-ui', exact: true })
    ).toBeVisible()
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

// BEGIN QUEST COMPARISON CAPTURE
// Self-contained: CI copies only this trial into the pinned pre-change checkout.
// Keep fixture identity, relative timings, and viewport sizes for later captures.
test(
  'Quest comparison capture renders the real page with synthetic operational data',
  {
    browser: true,
    world: {
      name: 'configured-slipway',
      context: {
        deploymentTarget: {
          slug: 'quest-showcase',
          name: 'Northstar Commerce'
        }
      }
    }
  },
  async ({ sails, world, login, page, expect }) => {
    const fs = require('node:fs')
    const path = require('node:path')
    const { execFileSync } = require('node:child_process')
    const phase = process.env.SLIPWAY_QUEST_CAPTURE_PHASE || 'current'
    const sourceSha = execFileSync('git', ['rev-parse', 'HEAD'], {
      encoding: 'utf8'
    }).trim()
    const root = path.resolve('.tmp/screenshots/quest-comparison', phase)
    fs.mkdirSync(root, { recursive: true })
    const current = world.current
    const environment = current.environments.production.id
    const now = Date.now()
    const minute = 60000
    const jobs = [
      {
        name: 'rebuild-search-index',
        friendlyName: 'Rebuild search index',
        description: 'Keep product and article search up to date.',
        schedule: '15 minutes',
        scheduleType: 'interval',
        paused: false,
        withoutOverlapping: true,
        isRunning: false,
        nextRunAt: now + 9 * minute
      },
      {
        name: 'sync-product-catalog',
        friendlyName: 'Sync product catalog',
        description: 'Refresh inventory and product details from suppliers.',
        schedule: '1 hour',
        scheduleType: 'interval',
        paused: false,
        withoutOverlapping: true,
        isRunning: true,
        nextRunAt: now + 56 * minute
      },
      {
        name: 'prune-temporary-uploads',
        friendlyName: 'Prune temporary uploads',
        description: 'Remove expired uploads after their retention window.',
        schedule: '0 2 * * *',
        scheduleType: 'cron',
        paused: false,
        withoutOverlapping: false,
        isRunning: false,
        nextRunAt: now + 480 * minute
      },
      {
        name: 'send-weekly-digest',
        friendlyName: 'Send weekly digest',
        description: 'Prepare the weekly summary for opted-in customers.',
        schedule: '0 9 * * 1',
        scheduleType: 'cron',
        paused: true,
        withoutOverlapping: true,
        isRunning: false,
        nextRunAt: null
      },
      {
        name: 'export-account-report',
        friendlyName: 'Export account report',
        description: 'Build an account activity report when requested.',
        schedule: null,
        scheduleType: 'manual',
        paused: false,
        withoutOverlapping: false,
        isRunning: false,
        nextRunAt: null
      }
    ]
    const events = [
      ['rebuild-search-index', 'completed', 6, 1480, 'manual'],
      ['rebuild-search-index', 'complete', 21, 1520, 'scheduled'],
      ['rebuild-search-index', 'complete', 36, 1410, 'scheduled'],
      ['rebuild-search-index', 'complete', 51, 1610, 'scheduled'],
      ['sync-product-catalog', 'complete', 4, 2840, 'scheduled'],
      ['sync-product-catalog', 'failed', 64, 820, 'manual'],
      ['sync-product-catalog', 'start', 1, 0, 'scheduled'],
      ['prune-temporary-uploads', 'complete', 140, 240, 'scheduled'],
      ['send-weekly-digest', 'complete', 1000, 5100, 'scheduled'],
      ['export-account-report', 'completed', 18, 820, 'manual']
    ]
    await sails.models.environment.updateOne({ id: environment }).set({
      features: {
        'sails-quest': { scripts: jobs.map(({ name }) => ({ name })) }
      }
    })
    await sails.models.app.updateOne({ id: current.apps.web.id }).set({
      status: 'running',
      containerName: 'synthetic-quest-showcase-never-executed'
    })
    await sails.models.team
      .updateOne({ id: current.teams.genesisTeam.id })
      .set({ name: 'Northstar' })
    await sails.models.user
      .updateOne({ id: current.users.genesisUser.id })
      .set({
        fullName: 'Alex Rivera',
        initials: 'AR',
        email: 'alex@example.com'
      })
    await sails.models.telemetrymetric.createEach(
      events.map(([jobName, event, minutesAgo, duration, trigger]) => ({
        environment,
        name: `quest.job.${event}`,
        value: duration,
        unit: 'ms',
        recordedAt: now - minutesAgo * minute,
        attributes: {
          jobName,
          trigger,
          ...(event === 'failed'
            ? { error: 'Synthetic supplier connection timed out.' }
            : {}),
          ...(event === 'completed' && jobName === 'rebuild-search-index'
            ? {
                stdout: 'Indexed 240 synthetic products and 18 articles.',
                stderr: 'Synthetic warning: 3 archived products were skipped.'
              }
            : {})
        }
      }))
    )
    const originalListJobs = sails.helpers.quest.listJobs
    const originalExecute = sails.helpers.quest.executeInContainer
    let discoveryCalls = 0
    let mutationRequests = 0
    sails.helpers.quest.listJobs = async () => {
      discoveryCalls++
      return { jobs, error: null }
    }
    sails.helpers.quest.executeInContainer = async () => {
      throw new Error('Capture fixtures must never execute a container.')
    }
    await page.raw.route('**/quest/**', (route) => {
      if (route.request().method() !== 'GET') {
        mutationRequests++
        return route.abort('blockedbyclient')
      }
      return route.continue()
    })
    try {
      // Fixed Date, with real timers, keeps relative labels identical while
      // leaving the actual app, SSE, navigation, and rendering paths intact.
      await page.raw.clock.setFixedTime(now)
      await login.withPassword('genesisUser', page, {
        password: current.auth.genesisUserPassword
      })
      await page.raw.waitForURL('**/')
      await expect(
        page.raw.getByRole('link', { name: 'Northstar Commerce', exact: true })
      ).toBeVisible()
      await page.goto('/projects/quest-showcase/quest')
      await expect(
        page.raw.getByRole('heading', {
          name: 'Rebuild search index',
          exact: true
        })
      ).toBeVisible()
      await expect(
        page.raw.getByRole('heading', {
          name: 'Export account report',
          exact: true
        })
      ).toBeVisible()
      await expect(
        page.raw.getByLabel('Live updates active', { exact: true })
      ).toBeVisible()
      const captures = [
        { name: 'desktop-light', width: 1440, height: 1000, scheme: 'light' },
        { name: 'desktop-dark', width: 1440, height: 1000, scheme: 'dark' },
        { name: 'mobile-light', width: 390, height: 844, scheme: 'light' },
        { name: 'mobile-dark', width: 390, height: 844, scheme: 'dark' }
      ]
      for (const capture of captures) {
        await page.raw.setViewportSize({
          width: capture.width,
          height: capture.height
        })
        await page.raw.emulateMedia({ colorScheme: capture.scheme })
        await page.raw
          .getByRole('heading', { name: 'Quest', exact: true })
          .scrollIntoViewIfNeeded()
        await page.raw.mouse.move(0, 0)
        await page.raw.evaluate(() => document.fonts.ready)
        await page.screenshot(
          path.join(root, `quest-${phase}-${capture.name}.png`),
          {
            animations: 'disabled',
            fullPage: false
          }
        )
      }
      expect(discoveryCalls > 0).toBe(true)
      expect(mutationRequests).toBe(0)
      expect(page).toHaveNoJavascriptErrors()
      fs.writeFileSync(
        path.join(root, 'fixture.json'),
        JSON.stringify(
          {
            fixtureVersion: 2,
            description:
              'Actual rendered Slipway Quest page with synthetic operational data; no Docker, customer, or production jobs executed. Screenshots are not mockups.',
            phase,
            sourceSha,
            captureTrialSourceSha:
              process.env.SLIPWAY_QUEST_CAPTURE_TRIAL_SHA || sourceSha,
            frozenBrowserTime: new Date(now).toISOString(),
            project: 'Northstar Commerce',
            team: 'Northstar',
            user: 'Alex Rivera / alex@example.com / AR (synthetic)',
            environment: 'production (synthetic fixture)',
            jobs: jobs.map(({ nextRunAt, ...job }) => ({
              ...job,
              nextRunInMinutes:
                nextRunAt === null ? null : (nextRunAt - now) / minute
            })),
            events: events.map(
              ([jobName, event, minutesAgo, durationMs, trigger]) => ({
                jobName,
                event,
                minutesAgo,
                durationMs,
                trigger
              })
            ),
            captures,
            selectedJob: null,
            selectedEvent: null
          },
          null,
          2
        ) + '\n'
      )
    } finally {
      await page.raw.goto('about:blank')
      sails.helpers.quest.listJobs = originalListJobs
      sails.helpers.quest.executeInContainer = originalExecute
    }
  }
)
// END QUEST COMPARISON CAPTURE
