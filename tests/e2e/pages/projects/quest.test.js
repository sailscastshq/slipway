const { test } = require('sounding')

// BEGIN QUEST COMPARISON CAPTURE
// CI extracts this entire bounded section into the pinned before checkout.
// Only synthetic JSON and transport are doubled: the page, layout, CSS, and
// browser pixels come from the actual checked-out source in both phases.
const questComparisonFixture = {
  fixtureVersion: 2,
  description:
    'Actual rendered Slipway Quest page with synthetic operational data; no Docker, customer, or production jobs executed. Screenshots are not mockups.',
  phase: 'before',
  sourceSha: '6fe3b2177bc867475f1e3d499f6f4de53d2d1e03',
  captureTrialSourceSha: 'd63784057779f4364b8c8c0a3b73eeaecbe721f9',
  frozenBrowserTime: '2026-10-02T19:46:07.005Z',
  project: 'Northstar Commerce',
  team: 'Northstar',
  user: 'Alex Rivera / alex@example.com / AR (synthetic)',
  environment: 'production (synthetic fixture)',
  jobs: [
    {
      name: 'rebuild-search-index',
      friendlyName: 'Rebuild search index',
      description: 'Keep product and article search up to date.',
      schedule: '15 minutes',
      scheduleType: 'interval',
      paused: false,
      withoutOverlapping: true,
      isRunning: false,
      nextRunInMinutes: 9
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
      nextRunInMinutes: 56
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
      nextRunInMinutes: 480
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
      nextRunInMinutes: null
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
      nextRunInMinutes: null
    }
  ],
  events: [
    {
      jobName: 'rebuild-search-index',
      event: 'completed',
      minutesAgo: 6,
      durationMs: 1480,
      trigger: 'manual'
    },
    {
      jobName: 'rebuild-search-index',
      event: 'complete',
      minutesAgo: 21,
      durationMs: 1520,
      trigger: 'scheduled'
    },
    {
      jobName: 'rebuild-search-index',
      event: 'complete',
      minutesAgo: 36,
      durationMs: 1410,
      trigger: 'scheduled'
    },
    {
      jobName: 'rebuild-search-index',
      event: 'complete',
      minutesAgo: 51,
      durationMs: 1610,
      trigger: 'scheduled'
    },
    {
      jobName: 'sync-product-catalog',
      event: 'complete',
      minutesAgo: 4,
      durationMs: 2840,
      trigger: 'scheduled'
    },
    {
      jobName: 'sync-product-catalog',
      event: 'failed',
      minutesAgo: 64,
      durationMs: 820,
      trigger: 'manual'
    },
    {
      jobName: 'sync-product-catalog',
      event: 'start',
      minutesAgo: 1,
      durationMs: 0,
      trigger: 'scheduled'
    },
    {
      jobName: 'prune-temporary-uploads',
      event: 'complete',
      minutesAgo: 140,
      durationMs: 240,
      trigger: 'scheduled'
    },
    {
      jobName: 'send-weekly-digest',
      event: 'complete',
      minutesAgo: 1000,
      durationMs: 5100,
      trigger: 'scheduled'
    },
    {
      jobName: 'export-account-report',
      event: 'completed',
      minutesAgo: 18,
      durationMs: 820,
      trigger: 'manual'
    }
  ],
  captures: [
    {
      name: 'desktop-light',
      width: 1440,
      height: 1000,
      scheme: 'light'
    },
    {
      name: 'desktop-dark',
      width: 1440,
      height: 1000,
      scheme: 'dark'
    },
    {
      name: 'mobile-light',
      width: 390,
      height: 844,
      scheme: 'light'
    },
    {
      name: 'mobile-dark',
      width: 390,
      height: 844,
      scheme: 'dark'
    }
  ],
  selectedJob: null,
  selectedEvent: null
}

function questComparisonData(current, phase) {
  const now = Date.parse(questComparisonFixture.frozenBrowserTime)
  const jobs = questComparisonFixture.jobs.map(
    ({ nextRunInMinutes, ...job }) => ({
      ...job,
      nextRunAt:
        nextRunInMinutes === null ? null : now + nextRunInMinutes * 60000
    })
  )
  const rawEvents = questComparisonFixture.events
    .map((event, index) => ({
      eventId: `synthetic-event-${index + 1}`,
      jobName: event.jobName,
      event: event.event,
      duration: event.durationMs,
      trigger: event.trigger,
      recordedAt: now - event.minutesAgo * 60000,
      error:
        event.event === 'failed'
          ? 'Synthetic supplier connection timed out.'
          : null,
      stdout:
        event.event === 'completed' && event.jobName === 'rebuild-search-index'
          ? 'Indexed 240 synthetic products and 18 articles.'
          : null,
      stderr:
        event.event === 'completed' && event.jobName === 'rebuild-search-index'
          ? 'Synthetic warning: 3 archived products were skipped.'
          : null
    }))
    .sort((a, b) => b.recordedAt - a.recordedAt)
  const workspace = {
    version: 1,
    mode: 'resident',
    observedAt: now,
    target: {
      appId: current.apps.web.id,
      appName: 'Web',
      environmentId: current.environments.production.id,
      environmentName: 'Production',
      deploymentId: 'synthetic-deployment',
      runtimeId: 'synthetic-runtime-v1'
    },
    capabilities: {
      invoke: true,
      pause: true,
      resume: true,
      cancel: false,
      results: true,
      typedInputs: true
    },
    jobs: jobs.map((job) => ({
      ...job,
      script: job.name,
      metadataVersion: 'synthetic-metadata-v1',
      timezone: 'UTC',
      inputs: [],
      scheduledInputs: {},
      validationErrors: []
    })),
    runs: [],
    legacyEvents: rawEvents.map(({ stdout, stderr, ...event }) => ({
      ...event,
      event: event.event === 'complete' ? 'completed' : event.event,
      legacy: true
    })),
    nextCursor: null,
    historyScope: 'Last 7 days',
    reason: null
  }
  return { now, jobs, rawEvents, workspace, phase }
}

async function installQuestFixture(
  { sails, world, page },
  phase = 'after',
  configure = () => {}
) {
  const current = world.current
  const fixture = questComparisonData(current, phase)
  const state = {
    ...fixture,
    initialJsonBytes: 0,
    questJsonBytes: 0,
    documentBytes: 0,
    mutationRequests: [],
    unexpectedRequests: [],
    details: {},
    logs: {},
    api: null
  }
  configure(state)
  await sails.models.environment
    .updateOne({ id: current.environments.production.id })
    .set({
      features: {
        'sails-quest': { scripts: fixture.jobs.map(({ name }) => ({ name })) }
      }
    })
  // The actual server sees a stopped app, so bootstrap cannot probe any runtime.
  // Only the browser's synthetic JSON has appRunning=true.
  await sails.models.app.updateOne({ id: current.apps.web.id }).set({
    status: 'stopped',
    containerName: ''
  })
  await sails.models.team
    .updateOne({ id: current.teams.genesisTeam.id })
    .set({ name: 'Northstar' })
  await sails.models.user.updateOne({ id: current.users.genesisUser.id }).set({
    fullName: 'Alex Rivera',
    initials: 'AR',
    // Scenarios share a datastore. Preserve the exact comparison identity,
    // while keeping interaction users unique within that same test process.
    email:
      current.projects.deploymentTarget.slug === 'quest-showcase'
        ? 'alex@example.com'
        : `alex+${current.projects.deploymentTarget.slug}@example.com`
  })
  const originalExecute = sails.helpers.quest.executeInContainer
  sails.helpers.quest.executeInContainer = async () => {
    throw new Error('Quest browser fixtures must never execute a container.')
  }
  state.restore = () => {
    sails.helpers.quest.executeInContainer = originalExecute
  }
  const projectPath = `/projects/${current.projects.deploymentTarget.slug}/quest`
  state.projectPath = projectPath
  await page.raw.route(
    (url) => url.pathname === projectPath,
    async (route) => {
      const response = await route.fetch()
      const source = await response.text()
      const isJson = response
        .headers()
        ['content-type']?.includes('application/json')
      const match = isJson
        ? null
        : source.match(
            /(<script[^>]*type="application\/json"[^>]*data-page="app"[^>]*>)([\s\S]*?)(<\/script>)/
          )
      if (!isJson && !match)
        throw new Error(
          'Expected the actual Inertia bootstrap, not replacement HTML.'
        )
      const payload = JSON.parse(isJson ? source : match[2])
      const synthetic =
        phase === 'before'
          ? {
              jobs: state.jobs,
              jobHistory: state.rawEvents.map(({ eventId, ...event }) => event),
              jobsError: null
            }
          : {
              workspace: state.workspace,
              jobs: undefined,
              jobHistory: undefined,
              jobsError: undefined
            }
      Object.assign(payload.props, synthetic, {
        appRunning: true,
        hasQuestFeature: true
      })
      const json = JSON.stringify(payload)
      state.initialJsonBytes = Buffer.byteLength(json)
      state.questJsonBytes = Buffer.byteLength(JSON.stringify(synthetic))
      const body = isJson
        ? json
        : source.replace(
            match[0],
            `${match[1]}${json.replace(/</g, '\\u003c')}${match[3]}`
          )
      state.documentBytes = Buffer.byteLength(body)
      await route.fulfill({ response, body })
    }
  )
  await page.raw.route('**/quest/**', async (route) => {
    const request = route.request()
    const url = new URL(request.url())
    const path = url.pathname.slice(url.pathname.indexOf('/quest/') + 7)
    if (request.method() !== 'GET')
      state.mutationRequests.push({
        path,
        method: request.method(),
        body: request.postDataJSON()
      })
    if (state.api && (await state.api(route, path, request))) return
    if (path === 'runs') {
      const job = url.searchParams.get('job')
      return route.fulfill({
        json: {
          runs: state.workspace.runs.filter(
            (run) => !job || run.jobName === job
          ),
          legacyEvents: state.workspace.legacyEvents.filter(
            (event) => !job || event.jobName === job
          ),
          nextCursor: null
        }
      })
    }
    if (path.startsWith('runs/')) {
      const [_, runId, suffix] = path.split('/')
      if (suffix === 'logs' && state.logs[runId])
        return route.fulfill({ json: state.logs[runId] })
      if (!suffix && state.details[runId])
        return route.fulfill({ json: { run: state.details[runId] } })
    }
    if (path.startsWith('events/')) {
      const event = state.rawEvents.find(
        (event) => String(event.eventId) === path.slice(7)
      )
      if (event)
        return route.fulfill({ json: { event: { ...event, legacy: true } } })
    }
    state.unexpectedRequests.push({ path, method: request.method() })
    return route.fulfill({
      status: 503,
      json: { error: 'No synthetic response configured.' }
    })
  })
  await page.raw.clock.setFixedTime(fixture.now)
  // Transport-only EventSource double. This permits deterministic disconnects
  // while exercising the real composable's reconnect timer and cleanup logic.
  await page.raw.addInitScript(({ jobs, rawEvents, workspace, phase }) => {
    window.__questStreams = []
    window.__questStreamOnline = true
    window.__questStreamPayload =
      phase === 'before'
        ? { jobs, jobHistory: rawEvents, jobsError: null }
        : { workspace }
    window.__questEmitWorkspace = (workspace) => {
      window.__questStreamPayload = { workspace }
      for (const stream of window.__questStreams) {
        if (!stream.closed && stream.url.includes('/quest/stream'))
          stream.onmessage?.({ data: JSON.stringify({ workspace }) })
      }
    }
    window.EventSource = class SyntheticQuestEventSource {
      constructor(url) {
        this.url = String(url)
        this.readyState = 0
        this.closed = false
        window.__questStreams.push(this)
        this.timer = setTimeout(() => {
          if (this.closed) return
          if (!window.__questStreamOnline)
            return this.onerror?.({ type: 'error' })
          this.readyState = 1
          this.onopen?.({ type: 'open' })
          if (this.url.includes('/quest/stream')) {
            if (!window.__questStreamBootstrapped) {
              const bootstrap = document.querySelector(
                'script[data-page="app"]'
              )
              const props = bootstrap
                ? JSON.parse(bootstrap.textContent).props
                : {}
              window.__questStreamPayload =
                phase === 'before'
                  ? {
                      jobs: props.jobs || jobs,
                      jobHistory: props.jobHistory || rawEvents,
                      jobsError: null
                    }
                  : { workspace: props.workspace || workspace }
              window.__questStreamBootstrapped = true
            }
            this.onmessage?.({
              data: JSON.stringify(window.__questStreamPayload)
            })
          }
        }, 10)
      }
      close() {
        clearTimeout(this.timer)
        this.closed = true
        this.readyState = 2
      }
    }
  }, fixture)
  return state
}

async function questBrowserMeasurements(page) {
  return page.raw.evaluate(() => {
    const navigation = performance.getEntriesByType('navigation')[0]
    const root =
      document.querySelector('[data-test="quest-workspace"]') ||
      document.querySelector('main') ||
      document.body
    const dialog = document.querySelector('dialog[open]')
    const walker = document.createTreeWalker(document, NodeFilter.SHOW_ALL)
    let documentNodeCount = 0
    while (walker.nextNode()) documentNodeCount++
    return {
      readyAfterNavigationMs: navigation
        ? Math.round(performance.now() - navigation.startTime)
        : null,
      domContentLoadedMs: navigation?.domContentLoadedEventEnd
        ? Math.round(navigation.domContentLoadedEventEnd)
        : null,
      loadEventMs: navigation?.loadEventEnd
        ? Math.round(navigation.loadEventEnd)
        : null,
      documentElementCount: document.querySelectorAll('*').length,
      documentNodeCount,
      workspaceHorizontalOverflowPx: Math.max(
        0,
        root.scrollWidth - root.clientWidth
      ),
      dialogHorizontalOverflowPx: dialog
        ? Math.max(0, dialog.scrollWidth - dialog.clientWidth)
        : 0,
      workspaceElementCount: root.querySelectorAll('*').length,
      horizontalOverflowPx: Math.max(
        0,
        document.documentElement.scrollWidth - innerWidth
      )
    }
  })
}

test(
  'Quest comparison capture renders the real page with synthetic operational data',
  {
    browser: true,
    world: {
      name: 'configured-slipway',
      context: {
        deploymentTarget: { slug: 'quest-showcase', name: 'Northstar Commerce' }
      }
    }
  },
  async (context) => {
    const { world, login, page, expect } = context
    const fs = require('node:fs')
    const path = require('node:path')
    const { execFileSync } = require('node:child_process')
    const phase = process.env.SLIPWAY_QUEST_CAPTURE_PHASE || 'after'
    const sourceSha = execFileSync('git', ['rev-parse', 'HEAD'], {
      encoding: 'utf8'
    }).trim()
    const root = path.resolve('.tmp/screenshots/quest-comparison', phase)
    fs.mkdirSync(root, { recursive: true })
    const state = await installQuestFixture(context, phase)
    const measurements = []
    try {
      await login.withPassword('genesisUser', page, {
        password: world.current.auth.genesisUserPassword
      })
      await page.raw.waitForURL('**/')
      for (const capture of questComparisonFixture.captures) {
        await page.raw.setViewportSize({
          width: capture.width,
          height: capture.height
        })
        await page.raw.emulateMedia({ colorScheme: capture.scheme })
        const timingSamples = []
        let geometry
        for (let sample = 0; sample < 5; sample++) {
          const start = performance.now()
          await page.goto(state.projectPath)
          await expect(
            page.raw.getByRole('heading', { name: 'Quest', exact: true })
          ).toBeVisible()
          await expect(
            page.raw.getByText('Rebuild search index', { exact: true }).first()
          ).toBeVisible()
          if (phase === 'before') {
            await expect(
              page.raw.getByLabel('Live updates active', { exact: true })
            ).toBeVisible()
          } else {
            await expect(
              page.raw.locator('[data-test="quest-workspace"]')
            ).toBeVisible()
            await page.raw.waitForFunction(() =>
              window.__questStreams.some(
                (stream) =>
                  stream.url.includes('/quest/stream') &&
                  !stream.closed &&
                  stream.readyState === 1
              )
            )
          }
          await page.raw.evaluate(() => document.fonts.ready)
          timingSamples.push(Math.round(performance.now() - start))
          geometry = await questBrowserMeasurements(page)
        }
        const sortedTimings = [...timingSamples].sort((a, b) => a - b)
        const measurement = {
          capture: capture.name,
          initialJsonBytes: state.initialJsonBytes,
          questJsonBytes: state.questJsonBytes,
          documentBytes: state.documentBytes,
          navigationToReadyMs: sortedTimings[2],
          navigationToReadySamplesMs: timingSamples,
          navigationToReadyMinMs: sortedTimings[0],
          navigationToReadyMaxMs: sortedTimings[4],
          ...geometry
        }
        measurements.push(measurement)
        await page.raw
          .getByRole('heading', { name: 'Quest', exact: true })
          .scrollIntoViewIfNeeded()
        await page.raw.mouse.move(0, 0)
        await page.screenshot(
          path.join(root, `quest-${phase}-${capture.name}.png`),
          { animations: 'disabled', fullPage: false }
        )
      }
      fs.writeFileSync(
        path.join(root, 'fixture.json'),
        JSON.stringify(
          {
            ...questComparisonFixture,
            phase,
            sourceSha,
            captureTrialSourceSha:
              process.env.SLIPWAY_QUEST_CAPTURE_TRIAL_SHA || sourceSha,
            rendering:
              'Actual checked-out Vue page and CSS; synthetic Inertia JSON and EventSource transport. No runtime commands executed.',
            legacyEventsAreRuns: false,
            selectedJob: null,
            sourceFixtureSha: questComparisonFixture.captureTrialSourceSha
          },
          null,
          2
        ) + '\n'
      )
      fs.writeFileSync(
        path.join(root, 'performance.json'),
        JSON.stringify(
          {
            phase,
            sourceSha,
            fixtureVersion: questComparisonFixture.fixtureVersion,
            frozenBrowserTime: questComparisonFixture.frozenBrowserTime,
            sampleJobs: 5,
            sampleEvents: 10,
            navigationSamplesPerCapture: 5,
            navigationStatistic:
              'Median of five sequential same-fixture navigations; raw samples retained. Assets were already visited during login, so this is not a cold-start benchmark.',
            measurements,
            budgets: {
              questJsonBytes: 65536,
              initialJsonBytes: 262144,
              documentElementCount: 4000,
              navigationToReadyMs: 15000
            },
            scope:
              'Synthetic browser rendering sample, not production runtime performance. The old 500-event bound and 30-second polling are not exercised. Transport doubles do not measure runtime discovery, polling, networking, or job execution.'
          },
          null,
          2
        ) + '\n'
      )
      expect(state.mutationRequests).toEqual([])
      expect(state.unexpectedRequests).toEqual([])
      expect(page).toHaveNoJavascriptErrors()
      if (phase !== 'before') {
        for (const measurement of measurements) {
          expect(measurement.questJsonBytes <= 65536).toBe(true)
          expect(measurement.initialJsonBytes <= 262144).toBe(true)
          expect(measurement.documentElementCount <= 4000).toBe(true)
          expect(measurement.navigationToReadyMs <= 15000).toBe(true)
          for (const elapsed of measurement.navigationToReadySamplesMs) {
            expect(elapsed <= 15000).toBe(true)
          }
          expect(measurement.horizontalOverflowPx <= 1).toBe(true)
          expect(measurement.workspaceHorizontalOverflowPx <= 1).toBe(true)
        }
      }
    } finally {
      await page.raw.goto('about:blank')
      state.restore()
    }
  }
)
// END QUEST COMPARISON CAPTURE

function configureTypedQuestJob(state) {
  const job = state.workspace.jobs.find(
    (job) => job.name === 'export-account-report'
  )
  job.inputs = [
    {
      name: 'account',
      friendlyName: 'Account',
      type: 'string',
      required: true,
      minLength: 3
    },
    {
      name: 'limit',
      friendlyName: 'Row limit',
      type: 'number',
      required: true,
      defaultsTo: 0,
      min: 1,
      max: 100
    },
    {
      name: 'dryRun',
      friendlyName: 'Dry run',
      type: 'boolean',
      required: true,
      defaultsTo: false
    },
    {
      name: 'format',
      friendlyName: 'Format',
      type: 'string',
      required: true,
      isIn: ['summary', 'full'],
      defaultsTo: 'summary'
    },
    {
      name: 'filters',
      friendlyName: 'Filters',
      type: 'json',
      required: true,
      defaultsTo: { region: 'eu' }
    },
    {
      name: 'note',
      friendlyName: 'Optional note',
      type: 'string',
      required: false
    }
  ]
}

function syntheticQuestRun(state, runId, overrides = {}) {
  return {
    runId,
    jobName: 'export-account-report',
    state: 'completed',
    trigger: 'manual',
    actor: 'Alex Rivera (synthetic)',
    requestedAt: state.now - 1000,
    startedAt: state.now - 900,
    finishedAt: state.now,
    duration: 900,
    exitCode: 0,
    resultStatus: 'available',
    ...overrides
  }
}

async function emitQuestWorkspace(page, state) {
  await page.raw.evaluate(
    (workspace) => window.__questEmitWorkspace(workspace),
    state.workspace
  )
}

async function captureQuestWorkspaceState(page, expect, name, anchor) {
  const fs = require('node:fs')
  const path = require('node:path')
  const root = path.resolve('.tmp/screenshots/quest-workspace-states')
  fs.mkdirSync(root, { recursive: true })
  for (const capture of questComparisonFixture.captures) {
    await page.raw.setViewportSize({
      width: capture.width,
      height: capture.height
    })
    await page.raw.emulateMedia({ colorScheme: capture.scheme })
    if (anchor) await anchor.scrollIntoViewIfNeeded()
    await page.raw.evaluate(() => document.fonts.ready)
    await page.raw.mouse.move(0, 0)
    const geometry = await questBrowserMeasurements(page)
    expect(geometry.horizontalOverflowPx <= 1).toBe(true)
    expect(geometry.workspaceHorizontalOverflowPx <= 1).toBe(true)
    expect(geometry.dialogHorizontalOverflowPx <= 1).toBe(true)
    await page.screenshot(
      path.join(root, `quest-${name}-${capture.name}.png`),
      { animations: 'disabled', fullPage: false }
    )
    const manifestPath = path.join(root, 'manifest.json')
    const manifest = fs.existsSync(manifestPath)
      ? JSON.parse(fs.readFileSync(manifestPath, 'utf8'))
      : {
          sourceSha: require('node:child_process')
            .execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' })
            .trim(),
          frozenBrowserTime: questComparisonFixture.frozenBrowserTime,
          transport:
            'Synthetic JSON and EventSource; actual application rendering',
          captures: []
        }
    manifest.captures.push({
      name,
      viewport: capture,
      filename: `quest-${name}-${capture.name}.png`,
      geometry
    })
    fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + '\n')
  }
  await page.raw.setViewportSize({ width: 1440, height: 1000 })
  await page.raw.emulateMedia({ colorScheme: 'light' })
}

test(
  'Quest typed inputs validate without dispatch and an accepted run becomes running then a structured result',
  {
    browser: true,
    world: {
      name: 'configured-slipway',
      context: {
        deploymentTarget: {
          slug: 'quest-typed-browser',
          name: 'Northstar Commerce'
        }
      }
    }
  },
  async (context) => {
    const { page, login, world, expect } = context
    const state = await installQuestFixture(
      context,
      'after',
      configureTypedQuestJob
    )
    const accepted = syntheticQuestRun(state, 'synthetic-accepted-run', {
      state: 'accepted',
      startedAt: null,
      finishedAt: null,
      duration: null,
      exitCode: null,
      resultStatus: 'unavailable'
    })
    let observeInvocation
    const invocationObserved = new Promise((resolve) => {
      observeInvocation = resolve
    })
    let releaseAcceptance
    const acceptance = new Promise((resolve) => {
      releaseAcceptance = resolve
    })
    const submittedInputs = {
      account: 'synthetic-account-42',
      limit: 25,
      dryRun: false,
      format: 'full',
      filters: { region: 'eu', includeArchived: false }
    }
    state.details[accepted.runId] = {
      ...accepted,
      inputs: submittedInputs,
      result: { status: 'unavailable' },
      error: null,
      deploymentId: 'synthetic-deployment',
      runtimeId: 'synthetic-runtime-v1'
    }
    let logsRequests = 0
    state.api = async (route, path, request) => {
      if (
        path === 'jobs/export-account-report/run' &&
        request.method() === 'POST'
      ) {
        observeInvocation()
        await acceptance
        state.workspace.runs = [accepted]
        await route.fulfill({ status: 202, json: { run: accepted } })
        return true
      }
      if (path === `runs/${accepted.runId}/logs`) logsRequests++
      return false
    }
    try {
      await login.withPassword('genesisUser', page, {
        password: world.current.auth.genesisUserPassword
      })
      await page.goto(`${state.projectPath}?job=export-account-report`)
      const opener = page.raw.locator(
        '[data-test="quest-job-detail"] [data-test="quest-open-run"]'
      )
      await expect(opener).toBeEnabled()
      await opener.focus()
      await page.raw.keyboard.press('Enter')
      const form = page.raw.locator('[data-test="quest-run-form"]')
      const confirm = page.raw.locator('[data-test="quest-confirm-run"]')
      await expect(form).toBeVisible()
      await expect(confirm).toBeDisabled()
      expect(state.mutationRequests).toEqual([])
      await page.raw.locator('[data-test="quest-production-confirm"]').check()
      await confirm.click()
      await expect(form).toContainText('This input is required.')
      await expect(form).toContainText('Must be at least 1.')
      expect(state.mutationRequests).toEqual([])
      await page.raw.locator('#quest-input-0').fill(submittedInputs.account)
      await page.raw.locator('#quest-input-1').fill('25')
      await expect(page.raw.locator('#quest-input-2')).toContainText('False')
      await page.raw.locator('#quest-input-3').click()
      await page.raw.getByRole('option', { name: 'full', exact: true }).click()
      await page.raw.locator('#quest-input-4').fill('{')
      await confirm.click()
      await expect(form).toContainText('Enter valid JSON.')
      expect(state.mutationRequests).toEqual([])
      await page.raw
        .locator('#quest-input-4')
        .fill(JSON.stringify(submittedInputs.filters))
      await emitQuestWorkspace(page, state)
      await expect(page.raw.locator('#quest-input-0')).toHaveValue(
        submittedInputs.account
      )
      await captureQuestWorkspaceState(page, expect, 'typed-inputs', form)
      // Repeated keyboard submission while acceptance is pending is one request.
      await confirm.focus()
      await page.raw.keyboard.press('Enter')
      await expect(confirm).toBeDisabled()
      await page.raw.keyboard.press('Enter')
      await invocationObserved
      expect(state.mutationRequests.length).toBe(1)
      const request = state.mutationRequests[0].body
      expect(request.jobInputs).toEqual(submittedInputs)
      expect(request.metadataVersion).toBe('synthetic-metadata-v1')
      expect(request.runtimeId).toBe('synthetic-runtime-v1')
      expect(request.productionConfirmed).toBe(true)
      expect(typeof request.requestId).toBe('string')
      expect(request.requestId.length > 10).toBe(true)
      expect(Object.hasOwn(request.jobInputs, 'note')).toBe(false)
      releaseAcceptance()
      await expect(form).not.toBeVisible()
      await expect(
        page.raw.locator('[data-test="quest-run-detail"]')
      ).toContainText('Accepted')
      expect(new URL(page.raw.url()).searchParams.get('run')).toBe(
        accepted.runId
      )
      expect(logsRequests).toBe(0)

      const running = { ...accepted, state: 'running', startedAt: state.now }
      state.workspace.runs = [running]
      state.details[accepted.runId] = {
        ...state.details[accepted.runId],
        ...running
      }
      state.workspace.jobs.find(
        (job) => job.name === accepted.jobName
      ).isRunning = true
      await emitQuestWorkspace(page, state)
      const detail = page.raw.locator('[data-test="quest-run-detail"]')
      await expect(detail).toContainText('Running')
      await expect(
        page.raw.locator('[data-test="quest-run-result"]')
      ).toContainText('when this run finishes')
      await captureQuestWorkspaceState(page, expect, 'running', detail)

      const completed = {
        ...running,
        state: 'completed',
        finishedAt: state.now + 1200,
        duration: 1200,
        exitCode: 0,
        resultStatus: 'available'
      }
      state.workspace.runs = [completed]
      state.workspace.jobs.find(
        (job) => job.name === accepted.jobName
      ).isRunning = false
      state.details[accepted.runId] = {
        ...state.details[accepted.runId],
        ...completed,
        result: {
          status: 'available',
          value: [
            { account: 'synthetic-account-42', processed: 25, skipped: 0 }
          ]
        }
      }
      state.logs[accepted.runId] = {
        stdout: 'Synthetic log text is not the return value.',
        stderr: 'Synthetic diagnostic warning with a successful exit code.',
        truncated: false,
        available: true
      }
      await emitQuestWorkspace(page, state)
      await expect(detail).toContainText('Completed')
      await expect(
        page.raw.locator('[data-test="quest-run-result"]')
      ).toContainText('processed')
      expect(logsRequests).toBe(0)
      await captureQuestWorkspaceState(
        page,
        expect,
        'structured-result',
        detail
      )
      await page.raw.getByRole('tab', { name: 'Logs', exact: true }).click()
      await expect(detail).toContainText('Synthetic diagnostic warning')
      await expect(detail).toContainText('Completed')
      expect(logsRequests).toBe(1)
      await page.raw
        .getByRole('button', { name: 'Result', exact: true })
        .click()
      await expect(
        page.raw.locator('[data-test="quest-run-result"]')
      ).not.toContainText('Synthetic log text')
      await page.raw.reload()
      await expect(detail).toContainText('Completed')
      expect(state.mutationRequests.length).toBe(1)
      expect(state.unexpectedRequests).toEqual([])
      expect(page).toHaveNoJavascriptErrors()
    } finally {
      releaseAcceptance()
      await page.raw.goto('about:blank')
      state.restore()
    }
  }
)

test(
  'Quest request rejection and uncertain acceptance never invent failed or completed runs',
  {
    browser: true,
    world: {
      name: 'configured-slipway',
      context: {
        deploymentTarget: {
          slug: 'quest-request-browser',
          name: 'Northstar Commerce'
        }
      }
    }
  },
  async (context) => {
    const { page, login, world, expect } = context
    const state = await installQuestFixture(context)
    let mode = 'http'
    state.api = async (route, path, request) => {
      if (
        path !== 'jobs/rebuild-search-index/run' ||
        request.method() !== 'POST'
      )
        return false
      if (mode === 'transport') await route.abort('failed')
      else if (mode === 'invalid')
        await route.fulfill({
          status: 200,
          contentType: 'text/html',
          body: '<html>Sign in</html>'
        })
      else
        await route.fulfill({
          status: mode === 'http' ? 403 : 200,
          json: { success: true, exitCode: 0 }
        })
      return true
    }
    try {
      await login.withPassword('genesisUser', page, {
        password: world.current.auth.genesisUserPassword
      })
      await page.goto(`${state.projectPath}?job=rebuild-search-index`)
      const opener = page.raw.locator(
        '[data-test="quest-job-detail"] [data-test="quest-open-run"]'
      )
      const form = page.raw.locator('[data-test="quest-run-form"]')
      const confirm = page.raw.locator('[data-test="quest-confirm-run"]')
      for (const failure of [
        'http',
        'transport',
        'invalid',
        'missing-run-id'
      ]) {
        mode = failure
        await opener.click()
        await expect(confirm).toBeDisabled()
        await page.raw.locator('[data-test="quest-production-confirm"]').check()
        await confirm.click()
        const error = page.raw.locator('[data-test="quest-run-request-error"]')
        await expect(error).toContainText(
          failure === 'http'
            ? 'Request rejected (HTTP 403)'
            : 'No acceptance was received'
        )
        if (failure !== 'http') {
          await expect(confirm).toBeDisabled()
          await expect(error).toContainText(
            'Check Runs before submitting again'
          )
        }
        await expect(
          page.raw.locator('[data-test="quest-run-row"]')
        ).toHaveCount(0)
        expect(new URL(page.raw.url()).searchParams.has('run')).toBe(false)
        if (failure === 'http' || failure === 'transport') {
          await captureQuestWorkspaceState(
            page,
            expect,
            failure === 'http' ? 'request-rejected' : 'request-unconfirmed',
            form
          )
        }
        await page.raw.keyboard.press('Escape')
        await expect(form).not.toBeVisible()
        await expect(opener).toBeFocused()
      }
      expect(state.mutationRequests.length).toBe(4)
      await page.raw.reload()
      await expect(
        page.raw.locator('[data-test="quest-workspace"]')
      ).toBeVisible()
      await expect(page.raw.locator('[data-test="quest-run-row"]')).toHaveCount(
        0
      )
      expect(state.mutationRequests.length).toBe(4)
      expect(state.unexpectedRequests).toEqual([])
      expect(page).toHaveNoJavascriptErrors()
    } finally {
      await page.raw.goto('about:blank')
      state.restore()
    }
  }
)

test(
  'Quest distinguishes captured values, missing results, execution failure, and uncorrelated legacy events',
  {
    browser: true,
    world: {
      name: 'configured-slipway',
      context: {
        deploymentTarget: {
          slug: 'quest-result-browser',
          name: 'Northstar Commerce'
        }
      }
    }
  },
  async (context) => {
    const { page, login, world, expect } = context
    const resultCases = [
      [
        'named-exit',
        {
          status: 'available',
          value: { reason: 'Synthetic validation exit' },
          exit: 'invalid'
        },
        'reason'
      ],
      ['null', { status: 'available', value: null }, 'null'],
      ['false', { status: 'available', value: false }, 'false'],
      ['zero', { status: 'available', value: 0 }, '0'],
      ['undefined', { status: 'undefined' }, 'This job returned undefined.'],
      [
        'unsupported',
        { status: 'unsupported' },
        'This runtime does not capture return values.'
      ],
      [
        'too-large',
        { status: 'too_large' },
        'The return value exceeded the capture limit.'
      ],
      [
        'serialization',
        { status: 'serialization_error' },
        'The return value could not be serialized.'
      ],
      [
        'unavailable',
        { status: 'unavailable' },
        'The return value is no longer available.'
      ]
    ]
    const state = await installQuestFixture(context, 'after', (state) => {
      for (const [name, result] of resultCases) {
        const run = syntheticQuestRun(state, `synthetic-result-${name}`, {
          resultStatus: result.status
        })
        state.workspace.runs.push(run)
        state.details[run.runId] = { ...run, inputs: {}, result, error: null }
      }
      const failed = syntheticQuestRun(state, 'synthetic-execution-failed', {
        state: 'failed',
        exitCode: 1,
        resultStatus: 'undefined'
      })
      state.workspace.runs.push(failed)
      state.details[failed.runId] = {
        ...failed,
        inputs: {},
        result: { status: 'undefined' },
        error: {
          name: 'Error',
          message: 'Synthetic report failed after acceptance.'
        }
      }
    })
    try {
      await login.withPassword('genesisUser', page, {
        password: world.current.auth.genesisUserPassword
      })
      for (const [name, , text] of resultCases) {
        await page.goto(
          `${state.projectPath}?job=export-account-report&run=synthetic-result-${name}`
        )
        await expect(
          page.raw.locator('[data-test="quest-run-result"]')
        ).toContainText(text)
        expect(new URL(page.raw.url()).searchParams.get('run')).toBe(
          `synthetic-result-${name}`
        )
        if (name === 'named-exit') {
          const detail = page.raw.locator('[data-test="quest-run-detail"]')
          await expect(detail).toContainText('Completed')
          await expect(detail).toContainText('Exit: invalid')
          await captureQuestWorkspaceState(page, expect, 'named-exit', detail)
        }
      }
      await captureQuestWorkspaceState(
        page,
        expect,
        'result-unavailable',
        page.raw.locator('[data-test="quest-run-detail"]')
      )
      await page.goto(
        `${state.projectPath}?job=export-account-report&run=synthetic-execution-failed`
      )
      const detail = page.raw.locator('[data-test="quest-run-detail"]')
      await expect(detail).toContainText('Failed')
      await expect(detail).toContainText(
        'Synthetic report failed after acceptance.'
      )
      await captureQuestWorkspaceState(page, expect, 'failed', detail)
      // Stable run links survive refresh; no invocation is replayed.
      await page.raw.reload()
      await expect(detail).toContainText(
        'Synthetic report failed after acceptance.'
      )
      await page.raw
        .getByRole('button', { name: 'Close run details', exact: true })
        .click()
      await expect(detail).toHaveCount(0)
      expect(new URL(page.raw.url()).searchParams.has('run')).toBe(false)
      await page.raw.goBack()
      await expect(detail).toContainText(
        'Synthetic report failed after acceptance.'
      )
      expect(new URL(page.raw.url()).searchParams.get('run')).toBe(
        'synthetic-execution-failed'
      )
      await page.raw.goForward()
      await expect(detail).toHaveCount(0)
      expect(state.mutationRequests).toEqual([])
      await page.goto(`${state.projectPath}?job=rebuild-search-index`)
      const event = page.raw.locator('[data-test="quest-legacy-event"]').first()
      await event.click()
      await expect(detail).toContainText('Legacy event')
      await expect(
        page.raw.locator('[data-test="quest-run-result"]')
      ).toContainText('Return values were not recorded for legacy events.')
      expect(new URL(page.raw.url()).searchParams.has('run')).toBe(false)
      await page.raw
        .getByRole('button', { name: 'Close run details', exact: true })
        .click()
      await expect(detail).toHaveCount(0)
      expect(state.mutationRequests).toEqual([])
      expect(state.unexpectedRequests).toEqual([])
      expect(page).toHaveNoJavascriptErrors()
    } finally {
      await page.raw.goto('about:blank')
      state.restore()
    }
  }
)

test(
  'Quest keyboard navigation, reconnects, and stale runtime snapshots preserve review and never replay mutations',
  {
    browser: true,
    world: {
      name: 'configured-slipway',
      context: {
        deploymentTarget: {
          slug: 'quest-reconnect-browser',
          name: 'Northstar Commerce'
        }
      }
    }
  },
  async (context) => {
    const { page, login, world, expect } = context
    const state = await installQuestFixture(
      context,
      'after',
      configureTypedQuestJob
    )
    try {
      await login.withPassword('genesisUser', page, {
        password: world.current.auth.genesisUserPassword
      })
      await page.goto(state.projectPath)
      await page.raw.getByLabel('Search jobs', { exact: true }).fill('catalog')
      await expect(page.raw.locator('[data-test="quest-job-row"]')).toHaveCount(
        1
      )
      const catalog = page.raw.getByRole('button', {
        name: 'View Sync product catalog',
        exact: true
      })
      await catalog.focus()
      await page.raw.keyboard.press('Enter')
      await expect(
        page.raw.getByRole('heading', {
          name: 'Sync product catalog',
          exact: true
        })
      ).toBeVisible()
      await expect(
        page.raw.locator(
          '[data-test="quest-job-detail"] [data-test="quest-open-run"]'
        )
      ).toBeDisabled()
      await captureQuestWorkspaceState(
        page,
        expect,
        'keyboard-running-job',
        page.raw.locator('[data-test="quest-job-detail"]')
      )
      await page.goto(`${state.projectPath}?job=export-account-report`)
      const workspace = page.raw.locator('[data-test="quest-workspace"]')
      const opener = page.raw.locator(
        '[data-test="quest-job-detail"] [data-test="quest-open-run"]'
      )
      const form = page.raw.locator('[data-test="quest-run-form"]')
      const confirm = page.raw.locator('[data-test="quest-confirm-run"]')
      await expect(opener).toBeEnabled()
      await opener.focus()
      await page.raw.keyboard.press('Enter')
      await expect(form).toBeVisible()
      await page.raw
        .locator('#quest-input-0')
        .fill('synthetic-draft-to-preserve')
      await page.raw.locator('#quest-input-1').fill('15')
      await page.raw.keyboard.press('Tab')
      await captureQuestWorkspaceState(page, expect, 'keyboard-review', form)
      await page.raw.keyboard.press('Escape')
      await expect(form).not.toBeVisible()
      await expect(opener).toBeFocused()
      expect(state.mutationRequests).toEqual([])

      // A stream error marks stale state immediately. Real reconnect scheduling
      // runs, while the controlled transport refuses to open until allowed.
      await page.raw.evaluate(() => {
        window.__questStreamOnline = false
        for (const stream of window.__questStreams) {
          if (!stream.closed && stream.url.includes('/quest/stream'))
            stream.onerror?.({ type: 'error' })
        }
      })
      await expect(opener).toBeDisabled()
      await expect(
        page.raw.locator('[data-test="quest-stream-status"]')
      ).toContainText('Reconnecting')
      await captureQuestWorkspaceState(page, expect, 'reconnecting', workspace)
      await page.raw.waitForFunction(
        () =>
          window.__questStreams.filter((stream) =>
            stream.url.includes('/quest/stream')
          ).length >= 2
      )
      expect(state.mutationRequests).toEqual([])
      await page.raw.evaluate(() => {
        window.__questStreamOnline = true
      })
      await expect(opener).toBeEnabled({ timeout: 10000 })
      await expect(
        page.raw.locator('[data-test="quest-stream-status"]')
      ).not.toContainText('Reconnecting')
      expect(state.mutationRequests).toEqual([])

      // A server-reported SSE failure is also stale, even if the transport stays open.
      await page.raw.evaluate(() => {
        for (const stream of window.__questStreams) {
          if (!stream.closed && stream.url.includes('/quest/stream')) {
            stream.onmessage?.({
              data: JSON.stringify({
                error: 'Synthetic snapshot retrieval failed.'
              })
            })
          }
        }
      })
      await expect(opener).toBeDisabled()
      await expect(workspace).toContainText(
        'Synthetic snapshot retrieval failed.'
      )
      await emitQuestWorkspace(page, state)
      await expect(opener).toBeEnabled()
      expect(state.mutationRequests).toEqual([])

      await opener.click()
      await page.raw.locator('[data-test="quest-production-confirm"]').check()
      await page.raw
        .locator('#quest-input-0')
        .fill('synthetic-retained-on-refresh')
      await emitQuestWorkspace(page, state)
      await expect(page.raw.locator('#quest-input-0')).toHaveValue(
        'synthetic-retained-on-refresh'
      )
      state.workspace.jobs.find(
        (job) => job.name === 'export-account-report'
      ).metadataVersion = 'synthetic-metadata-v2'
      await emitQuestWorkspace(page, state)
      await expect(form).toContainText('The job or runtime changed')
      await expect(confirm).toBeDisabled()
      await expect(page.raw.locator('#quest-input-0')).toHaveValue(
        'synthetic-retained-on-refresh'
      )
      await page.raw.keyboard.press('Escape')
      await expect(form).not.toBeVisible()

      state.workspace.mode = 'unavailable'
      state.workspace.reason = 'Synthetic resident runtime is disconnected.'
      state.workspace.liveStateUnavailable = true
      state.workspace.capabilities = Object.fromEntries(
        Object.keys(state.workspace.capabilities).map((name) => [name, false])
      )
      await emitQuestWorkspace(page, state)
      await expect(workspace).toContainText(
        'Synthetic resident runtime is disconnected.'
      )
      await expect(opener).toBeDisabled()
      await captureQuestWorkspaceState(page, expect, 'disconnected', workspace)
      expect(state.mutationRequests).toEqual([])

      // Legacy snapshots remain readable while explicitly lacking live controls.
      state.workspace.mode = 'legacy'
      state.workspace.reason =
        'Synthetic legacy runtime has no resident control channel.'
      await emitQuestWorkspace(page, state)
      await expect(workspace).toContainText(
        'Synthetic legacy runtime has no resident control channel.'
      )
      await expect(opener).toBeDisabled()
      await captureQuestWorkspaceState(
        page,
        expect,
        'legacy-read-only',
        workspace
      )
      await page.raw.reload()
      await expect(opener).toBeDisabled()
      expect(new URL(page.raw.url()).searchParams.get('job')).toBe(
        'export-account-report'
      )
      expect(state.mutationRequests).toEqual([])
      expect(state.unexpectedRequests).toEqual([])
      expect(page).toHaveNoJavascriptErrors()
    } finally {
      await page.raw.goto('about:blank')
      state.restore()
    }
  }
)
