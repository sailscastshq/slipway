const { test } = require('sounding')

test(
  'Quest running disclosure preserves truthful activity and a quiet responsive workspace',
  {
    browser: true,
    world: {
      name: 'configured-slipway',
      context: {
        deploymentTarget: {
          slug: 'quest-design-review',
          name: 'Northstar Commerce'
        }
      }
    }
  },
  async (context) => {
    const { page, login, expect } = context
    const state = await installQuestFixture(context)
    const fs = require('node:fs')
    const path = require('node:path')
    const phase = process.env.SLIPWAY_QUEST_DESIGN_CAPTURE_PHASE || 'after'
    const root = path.resolve('.tmp/sounding/artifacts/quest-design-review')
    fs.mkdirSync(root, { recursive: true })
    try {
      await login.withPassword('genesisUser', page, {
        password: context.world.current.auth.genesisUserPassword
      })
      await page.raw.waitForURL('**/')
      await page.goto(state.projectPath)
      await expect(
        page.raw.getByRole('heading', { name: 'Quest', exact: true })
      ).toBeVisible()
      const strip = page.raw.locator('[data-test="quest-running-jobs"]')
      if (phase !== 'before') {
        const disclosure = strip.getByRole('button', {
          name: '1 job running',
          exact: true
        })
        await expect(disclosure).toHaveAttribute('aria-expanded', 'false')
        await disclosure.focus()
        await page.raw.keyboard.press('Enter')
        await expect(disclosure).toHaveAttribute('aria-expanded', 'true')
        await expect(
          strip.getByRole('button', { name: /Sync product catalog/ })
        ).toBeVisible()
        await emitQuestWorkspace(page, state)
        await expect(disclosure).toHaveAttribute('aria-expanded', 'true')
        await strip
          .getByRole('button', { name: /Sync product catalog/ })
          .click()
        await expect(page.raw.locator('#quest-job-title')).toHaveText(
          'Sync product catalog'
        )
        expect(new URL(page.raw.url()).searchParams.get('job')).toBe(
          'sync-product-catalog'
        )
        await page.raw
          .getByRole('button', { name: 'Close job details', exact: true })
          .click()
        await disclosure.focus()
        await page.raw.keyboard.press('Space')
        await expect(disclosure).toHaveAttribute('aria-expanded', 'false')
      }
      await page.raw
        .getByRole('button', {
          name: 'View Export account report',
          exact: true
        })
        .click()
      await page.raw.getByRole('tab', { name: 'Schedule', exact: true }).click()
      if (phase !== 'before')
        await strip
          .getByRole('button', { name: '1 job running', exact: true })
          .click()
      for (const capture of questComparisonFixture.captures) {
        await page.raw.setViewportSize({
          width: capture.width,
          height: capture.height
        })
        await page.raw.emulateMedia({ colorScheme: capture.scheme })
        await page.raw.evaluate(() => document.fonts.ready)
        const geometry = await questBrowserMeasurements(page)
        expect(geometry.horizontalOverflowPx <= 1).toBe(true)
        expect(geometry.workspaceHorizontalOverflowPx <= 1).toBe(true)
        await page.screenshot(path.join(root, `${phase}-${capture.name}.png`), {
          animations: 'disabled',
          fullPage: false
        })
      }
      if (phase === 'before') return
      // A disconnect preserves the last observation without calling it current.
      await page.raw.evaluate(() => {
        for (const stream of window.__questStreams || [])
          if (!stream.closed && stream.url.includes('/quest/stream'))
            stream.onerror?.(new Event('error'))
      })
      await expect(strip).toContainText('Running activity unknown')
      await expect(strip).toContainText('Last observed running')
      await expect(strip).not.toContainText('completed')
      await expect(strip.getByRole('button', { name: /Cancel/ })).toHaveCount(0)
      await page.screenshot(path.join(root, 'after-mobile-disconnected.png'), {
        animations: 'disabled',
        fullPage: false
      })
      // A new runtime's explicit idle snapshot replaces old activity. It does
      // not infer a completed outcome for jobs from the previous runtime.
      state.workspace.target.runtimeId = 'synthetic-runtime-v2'
      for (const job of state.workspace.jobs) job.isRunning = false
      await emitQuestWorkspace(page, state)
      await expect(strip).toContainText('No jobs running')
      await expect(strip.getByRole('button')).toHaveCount(0)
      await expect(page.raw.locator('#quest-running-jobs-list')).toBeHidden()
      await expect(strip).not.toContainText('completed')
      state.workspace.jobs[0].isRunning = null
      await emitQuestWorkspace(page, state)
      await expect(strip).toContainText('Running activity incomplete')
      await expect(strip.getByRole('button')).toHaveAttribute(
        'aria-expanded',
        'true'
      )
      await expect(
        strip.getByText('Some jobs have not reported their running state.')
      ).toBeVisible()
      expect(state.mutationRequests).toEqual([])
      expect(state.unexpectedRequests).toEqual([])
      expect(page).toHaveNoJavascriptErrors()
    } finally {
      await page.raw.goto('about:blank')
      state.restore()
    }
  }
)

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
      inputMetadataAvailable: true,
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
  configure = () => {},
  { clockMode = 'advancing' } = {}
) {
  const current = world.current
  const fixture = questComparisonData(current, phase)
  const attributionTrace = process.env.SLIPWAY_QUEST_ATTRIBUTION_TRACE === '1'
  if (attributionTrace) {
    if (process.env.SLIPWAY_QUEST_PRODUCTION_BENCHMARK !== '1')
      throw new Error('Quest attribution requires actual production assets')
    await page.raw.addInitScript(
      require('../../../support/quest-attribution-trace.cjs')
        .installBrowserProbe,
      {
        projectPath: `/projects/${current.projects.deploymentTarget.slug}/quest`
      }
    )
  }
  const preloadMode = process.env.SLIPWAY_QUEST_PRELOAD_MODE || 'on'
  const fs = require('node:fs')
  const preloadPath = '.tmp/public/quest-preload-manifest.json'
  const preloadManifest =
    clockMode.startsWith('native-performance') && fs.existsSync(preloadPath)
      ? JSON.parse(fs.readFileSync(preloadPath, 'utf8'))
      : null
  if (!['off', 'on'].includes(preloadMode))
    throw new Error('Invalid Quest preload comparison mode')
  if (
    process.env.SLIPWAY_QUEST_PRELOAD_MODE &&
    !preloadManifest?.assets?.length
  )
    throw new Error(
      'Preload control requires the actual current production route manifest'
    )
  const state = {
    ...fixture,
    clockMode,
    preloadMode,
    preloadAssets: preloadManifest?.assets || [],
    initialJsonBytes: 0,
    questJsonBytes: 0,
    documentBytes: 0,
    bootstrapMeasurements: [],
    mutationRequests: [],
    unexpectedRequests: [],
    infrastructureRequests: [],
    infrastructureFailures: [],
    fixtureErrors: [],
    scriptRequests: [],
    scriptResponses: [],
    scriptFailures: [],
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
      try {
        const fetchStart = clockMode.startsWith('native-performance')
          ? performance.now()
          : null
        const response = await route.fetch()
        const fetchEnd = clockMode.startsWith('native-performance')
          ? performance.now()
          : null
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
                jobHistory: state.rawEvents.map(
                  ({ eventId, ...event }) => event
                ),
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
        let body = isJson
          ? json
          : source.replace(
              match[0],
              `${match[1]}${json.replace(/</g, '\\u003c')}${match[3]}`
            )
        if (!isJson && clockMode.startsWith('native-performance')) {
          const tags =
            body.match(/<link\b[^>]*\bdata-quest-preload="1"[^>]*>/g) || []
          if (tags.length !== state.preloadAssets.length)
            throw new Error(
              `Rendered Quest preload hints must match the compiled route manifest: expected ${state.preloadAssets.length}, rendered ${tags.length}`
            )
          if (preloadMode === 'off')
            body = body.replace(
              /<link\b[^>]*\bdata-quest-preload="1"[^>]*>/g,
              ''
            )
        }
        state.documentBytes = Buffer.byteLength(body)
        if (clockMode.startsWith('native-performance')) {
          state.bootstrapMeasurements.push({
            fetchMs: fetchEnd - fetchStart,
            rewriteMs: performance.now() - fetchEnd
          })
        }
        await route.fulfill({ response, body })
      } catch (error) {
        const message = error?.stack || String(error)
        state.fixtureErrors.push(message)
        console.error('QUEST_FIXTURE_ROUTE_ERROR ' + message)
        // Settle the intercepted request so an actionable fixture error does
        // not disappear behind a 30-second navigation timeout.
        await route.abort('failed')
      }
    }
  )
  const apiPath = `/api/v1/projects/${current.projects.deploymentTarget.slug}/quest/`
  await page.raw.route(
    (url) =>
      url.pathname.startsWith(apiPath) ||
      url.pathname.startsWith(projectPath + '/'),
    async (route) => {
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
        if (!suffix && state.details[runId]) {
          const detail = state.details[runId]
          const run =
            url.searchParams.get('summaryOnly') === 'true'
              ? Object.fromEntries(
                  [
                    'runId',
                    'jobName',
                    'state',
                    'trigger',
                    'actor',
                    'requestedAt',
                    'startedAt',
                    'finishedAt',
                    'duration',
                    'exitCode',
                    'resultStatus',
                    'updatedAt'
                  ].map((key) => [key, detail[key] ?? null])
                )
              : detail
          return route.fulfill({ json: { run } })
        }
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
    }
  )
  const isLazyCompilation = (url) => /lazy[_-]compilation/i.test(url)
  const recordInfrastructureRequest = (request) => {
    if (request.resourceType() === 'script')
      state.scriptRequests.push(new URL(request.url()).pathname)
    if (!isLazyCompilation(request.url())) return
    state.infrastructureRequests.push({
      url: request.url(),
      method: request.method(),
      contentType: request.headers()['content-type'],
      body: request.postData()?.slice(0, 2000) || null
    })
  }
  const recordInfrastructureResponse = async (response) => {
    if (response.request().resourceType() === 'script')
      state.scriptResponses.push({
        path: new URL(response.url()).pathname,
        status: response.status()
      })
    if (
      response.request().resourceType() === 'script' &&
      response.status() >= 400
    )
      state.scriptFailures.push({
        path: new URL(response.url()).pathname,
        status: response.status()
      })
    if (!isLazyCompilation(response.url()) || response.status() < 400) return
    let body = ''
    try {
      body = (await response.text()).slice(0, 2000)
    } catch {}
    state.infrastructureFailures.push({
      url: response.url(),
      status: response.status(),
      body
    })
  }
  page.raw.on('request', recordInfrastructureRequest)
  page.raw.on('response', recordInfrastructureResponse)
  const restore = state.restore
  state.restore = () => {
    page.raw.off('request', recordInfrastructureRequest)
    page.raw.off('response', recordInfrastructureResponse)
    restore()
  }
  if (clockMode.startsWith('native-performance')) {
    // Production profiling only: keep the exact visual Date fixture without
    // Playwright's full clock shim, which removes native Performance entries.
    // No timer, performance method, application state, or event is replaced.
    await page.raw.addInitScript(
      ({ now, phase, projectPath, clockMode, attributionTrace }) => {
        const NativeDate = Date
        const wallOrigin = NativeDate.now()
        const clockNow = () =>
          now +
          (clockMode.endsWith('-advancing') ? NativeDate.now() - wallOrigin : 0)
        function FixtureDate(...args) {
          if (!new.target) return new NativeDate(clockNow()).toString()
          return Reflect.construct(
            NativeDate,
            args.length ? args : [clockNow()],
            new.target
          )
        }
        Object.setPrototypeOf(FixtureDate, NativeDate)
        FixtureDate.prototype = NativeDate.prototype
        FixtureDate.now = clockNow
        window.Date = FixtureDate
        const profile = (window.__questNativeProfile = {
          readyMs: null,
          contentReadyMs: null,
          paints: [],
          longTasks: []
        })
        for (const [type, key] of [
          ['paint', 'paints'],
          ['longtask', 'longTasks']
        ]) {
          if (PerformanceObserver.supportedEntryTypes.includes(type)) {
            new PerformanceObserver((list) =>
              profile[key].push(
                ...list.getEntries().map((entry) => entry.toJSON())
              )
            ).observe({ type, buffered: true })
          }
        }
        if (location.pathname !== projectPath) return
        const observeReady = () => {
          const phaseElement = document.querySelector(
            phase === 'before'
              ? '[aria-label="Live updates active"]'
              : '[data-test="quest-workspace"]'
          )
          const streamReady = window.__questStreams?.some(
            (stream) => !stream.closed && stream.readyState === 1
          )
          const heading = [...document.querySelectorAll('h1,h2,h3')].some(
            (el) => el.textContent.trim() === 'Quest'
          )
          // Bracket the one existing readiness read; do not add a layout read.
          const phaseRects = attributionTrace
            ? window.__questAttributionProbe.readinessRects(phaseElement)
            : phaseElement?.getClientRects()
          if (
            phaseRects?.length &&
            streamReady &&
            heading &&
            document.body?.textContent.includes('Rebuild search index') &&
            document.fonts.status === 'loaded'
          ) {
            profile.contentReadyMs = performance.now()
            performance.mark('quest-native-content-ready')
            requestAnimationFrame(() =>
              requestAnimationFrame(() => {
                performance.mark('quest-native-ready')
                profile.readyMs = performance.now()
                // Freeze the marker inventory at the existing ready boundary;
                // late ResizeObserver callbacks cannot race the CDP drain.
                if (attributionTrace) window.__questAttributionProbe.finish()
              })
            )
          } else requestAnimationFrame(observeReady)
        }
        requestAnimationFrame(observeReady)
      },
      { now: fixture.now, phase, projectPath, clockMode, attributionTrace }
    )
  } else if (clockMode === 'fixed')
    await page.raw.clock.setFixedTime(fixture.now)
  else await page.raw.clock.setSystemTime(fixture.now)
  // Transport-only EventSource double. This permits deterministic disconnects
  // while exercising the real composable's reconnect timer and cleanup logic.
  await page.raw.addInitScript(
    ({
      jobs,
      rawEvents,
      workspace,
      phase,
      questStreamPath,
      clockMode,
      attributionTrace
    }) => {
      window.__questStreams = []
      window.__questStreamOnline = true
      window.__questObservationPaused = false
      window.__questStreamPayload =
        phase === 'before'
          ? { jobs, jobHistory: rawEvents, jobsError: null }
          : { workspace }
      window.__questEmitWorkspace = (workspace, allowHeartbeat = true) => {
        window.__questObservationPaused =
          !allowHeartbeat || workspace.mode !== 'resident'
        window.__questStreamPayload = { workspace }
        for (const stream of window.__questStreams) {
          if (!stream.closed && stream.url.includes('/quest/stream'))
            stream.onmessage?.({ data: JSON.stringify({ workspace }) })
        }
      }
      const NativeEventSource = window.EventSource
      window.EventSource = class SyntheticQuestEventSource {
        static CONNECTING = NativeEventSource.CONNECTING
        static OPEN = NativeEventSource.OPEN
        static CLOSED = NativeEventSource.CLOSED
        constructor(url, options) {
          // Keep bundler/HMR and other application transports real. Only this
          // project's exact Quest stream contract is doubled.
          if (
            new URL(String(url), location.href).pathname !== questStreamPath
          ) {
            return new NativeEventSource(url, options)
          }
          this.url = String(url)
          this.readyState = 0
          this.closed = false
          window.__questStreams.push(this)
          const probe = attributionTrace ? window.__questAttributionProbe : null
          const streamId = probe?.next('sse')
          probe?.mark('sse-register', streamId, 'begin')
          this.timer = setTimeout(() => {
            probe?.mark('sse-callback', streamId, 'begin')
            try {
              if (this.closed) return
              if (!window.__questStreamOnline)
                return this.onerror?.({ type: 'error' })
              this.readyState = 1
              probe?.mark('sse-open', streamId, 'begin')
              try {
                this.onopen?.({ type: 'open' })
              } finally {
                probe?.mark('sse-open', streamId, 'end')
              }
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
                if (
                  (clockMode === 'advancing' ||
                    clockMode === 'native-performance-advancing') &&
                  !window.__questObservationPaused &&
                  window.__questStreamPayload.workspace?.mode === 'resident'
                ) {
                  window.__questStreamPayload.workspace.observedAt = Date.now()
                }
                probe?.mark('sse-message', streamId, 'begin')
                try {
                  this.onmessage?.({
                    data: JSON.stringify(window.__questStreamPayload)
                  })
                } finally {
                  probe?.mark('sse-message', streamId, 'end')
                }
                if (
                  clockMode === 'advancing' ||
                  clockMode === 'native-performance-advancing'
                ) {
                  this.heartbeat = setInterval(() => {
                    if (
                      this.closed ||
                      !window.__questStreamOnline ||
                      window.__questObservationPaused
                    )
                      return
                    const current = window.__questStreamPayload.workspace
                    if (current?.mode !== 'resident') return
                    current.observedAt = Date.now()
                    this.onmessage?.({
                      data: JSON.stringify({ workspace: current })
                    })
                  }, 5000)
                }
              }
            } finally {
              probe?.mark('sse-callback', streamId, 'end')
            }
          }, 10)
          probe?.mark('sse-register', streamId, 'end')
        }
        close() {
          clearTimeout(this.timer)
          clearInterval(this.heartbeat)
          this.closed = true
          this.readyState = 2
        }
      }
    },
    {
      ...fixture,
      questStreamPath: apiPath + 'stream',
      clockMode,
      attributionTrace
    }
  )
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
      browserClockTime: new Date().toISOString(),
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
    const attributionTrace = process.env.SLIPWAY_QUEST_ATTRIBUTION_TRACE === '1'
    const attribution = attributionTrace
      ? require('../../../support/quest-attribution-trace.cjs')
      : null
    const root = path.resolve(
      attributionTrace
        ? '.tmp/screenshots/quest-attribution'
        : '.tmp/screenshots/quest-comparison',
      phase
    )
    fs.mkdirSync(root, { recursive: true })
    const productionBenchmark =
      process.env.SLIPWAY_QUEST_PRODUCTION_BENCHMARK === '1'
    let cdp
    let productionBuild
    if (productionBenchmark) {
      const assert = require('node:assert/strict')
      // These are test-app assertions, not a production application lift.
      assert.notEqual(process.env.NODE_ENV, 'production')
      assert.equal(context.sails.config.environment, 'test')
      assert.equal(context.sails.config.hooks.quest, false)
      assert.equal(context.sails.config.hooks.lookout, false)
      assert.equal(context.sails.config.hooks.shipwright, false)
      assert.equal(
        context.sails.config.datastores.observability.url,
        process.env.SLIPWAY_TEST_NATIVE_CONFIG
          ? JSON.parse(
              fs.readFileSync(process.env.SLIPWAY_TEST_NATIVE_CONFIG, 'utf8')
            ).datastores.observability.url
          : ':memory:'
      )
      assert.equal(context.sails.config.session.url, ':memory:')
      productionBuild = JSON.parse(
        fs.readFileSync('.tmp/quest-production-build.json', 'utf8')
      )
      assert.equal(productionBuild.sourceSha, sourceSha)
      assert.equal(productionBuild.buildMode, 'production')
      assert.equal(productionBuild.applicationLifted, false)
      cdp = await page.raw.context().newCDPSession(page.raw)
      await cdp.send('Performance.enable')
    }
    const state = await installQuestFixture(context, phase, () => {}, {
      clockMode: productionBenchmark ? 'native-performance' : 'fixed'
    })
    const measurements = []
    const attributionSamples = []
    let activeTrace
    try {
      await login.withPassword('genesisUser', page, {
        password: world.current.auth.genesisUserPassword
      })
      await page.raw.waitForURL('**/')
      const captures = attributionTrace
        ? questComparisonFixture.captures.filter(
            (capture) => capture.name === 'desktop-light'
          )
        : questComparisonFixture.captures
      for (const capture of captures) {
        await page.raw.setViewportSize({
          width: capture.width,
          height: capture.height
        })
        await page.raw.emulateMedia({ colorScheme: capture.scheme })
        const timingSamples = []
        const productionSamples = []
        let geometry
        for (let sample = 0; sample < 5; sample++) {
          state.bootstrapMeasurements = []
          const cdpBefore = cdp
            ? Object.fromEntries(
                (await cdp.send('Performance.getMetrics')).metrics.map(
                  ({ name, value }) => [name, value]
                )
              )
            : null
          if (attributionTrace)
            activeTrace = await attribution.startTrace(cdp, root, sample)
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
          }
          await page.raw.waitForFunction(() =>
            window.__questStreams.some(
              (stream) =>
                stream.url.includes('/quest/stream') &&
                !stream.closed &&
                stream.readyState === 1
            )
          )
          await page.raw.evaluate(() => document.fonts.ready)
          if (productionBenchmark)
            await page.raw.waitForFunction(() =>
              Number.isFinite(window.__questNativeProfile?.readyMs)
            )
          timingSamples.push(Math.round(performance.now() - start))
          if (productionBenchmark) {
            const native = await page.raw.evaluate(
              ({ attributionTrace }) => ({
                ...window.__questNativeProfile,
                ...(attributionTrace
                  ? {
                      attribution: window.__questAttributionProbe.state,
                      filterPresent: !!document.querySelector(
                        '[data-slot="select-trigger"][aria-label="Filter jobs by state"]'
                      ),
                      paints: performance
                        .getEntriesByType('paint')
                        .map((entry) => ({
                          ...entry.toJSON(),
                          paintTime: entry.paintTime ?? null,
                          presentationTime: entry.presentationTime ?? null
                        }))
                    }
                  : {}),
                navigation: performance
                  .getEntriesByType('navigation')[0]
                  ?.toJSON(),
                readyMarks: performance
                  .getEntriesByName('quest-native-ready')
                  .map((entry) => entry.toJSON()),
                resources: performance
                  .getEntriesByType('resource')
                  .map((entry) => ({
                    ...entry.toJSON(),
                    name: new URL(entry.name).pathname
                  })),
                assetUrls: [
                  ...document.querySelectorAll(
                    'script[src],link[rel="stylesheet"][href]'
                  )
                ].map((el) => new URL(el.src || el.href).pathname),
                preloadUrls: [
                  ...document.querySelectorAll('link[data-quest-preload="1"]')
                ].map((el) => new URL(el.href).pathname)
              }),
              { attributionTrace }
            )
            if (attributionTrace) {
              const trace = await activeTrace.stop()
              activeTrace = null
              const { frameTree } = await cdp.send('Page.getFrameTree')
              const observation = {
                sample,
                capture: capture.name,
                phase,
                sourceSha,
                frameId: frameTree.frame.id,
                trace,
                native,
                bootstrap: state.bootstrapMeasurements
              }
              observation.analysis = attribution.analyzeTrace(
                JSON.parse(
                  fs.readFileSync(path.join(root, trace.traceFile), 'utf8')
                ),
                observation
              )
              attributionSamples.push(observation)
              fs.writeFileSync(
                path.join(root, `sample-${sample}.json`),
                JSON.stringify(observation, null, 2) + '\n'
              )
            }
            expect(native.navigation.responseEnd > 0).toBe(true)
            expect(native.readyMs >= native.navigation.responseEnd).toBe(true)
            const assetUrls = new Set(
              productionBuild.assets.map((asset) => asset.url)
            )
            for (const url of native.assetUrls)
              expect(assetUrls.has(url)).toBe(true)
            expect([...native.preloadUrls].sort()).toEqual(
              state.preloadMode === 'off' ? [] : [...state.preloadAssets].sort()
            )
            const staticResources = native.resources.filter((entry) =>
              /\.(?:js|css)$/.test(entry.name)
            )
            expect(
              new Set(staticResources.map((entry) => entry.name)).size
            ).toBe(staticResources.length)
            expect(
              native.resources.some((entry) =>
                /rsbuild|lazy-compilation|webpack/i.test(entry.name)
              )
            ).toBe(false)
            const cdpAfter = Object.fromEntries(
              (await cdp.send('Performance.getMetrics')).metrics.map(
                ({ name, value }) => [name, value]
              )
            )
            productionSamples.push({
              native,
              cdpBefore,
              cdpAfter,
              bootstrap: state.bootstrapMeasurements
            })
          }
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
          ...(productionBenchmark ? { productionSamples } : {}),
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
            sourceFixtureSha: questComparisonFixture.captureTrialSourceSha,
            ...(attributionTrace
              ? {
                  reconstructed: true,
                  captures: [questComparisonFixture.captures[0]]
                }
              : {})
          },
          null,
          2
        ) + '\n'
      )
      fs.writeFileSync(
        path.join(
          root,
          attributionTrace ? 'attribution.json' : 'performance.json'
        ),
        JSON.stringify(
          attributionTrace
            ? {
                reconstructed: true,
                phase,
                sourceSha,
                productionBenchmark,
                productionBuild,
                captureTrialSourceSha:
                  process.env.SLIPWAY_QUEST_CAPTURE_TRIAL_SHA || sourceSha,
                samples: attributionSamples,
                scope:
                  'Instrumented mechanism diagnostic only; separate from uninstrumented production/preload reports. Reconstructed unpublished harness, not recovered historical measurements.'
              }
            : {
                phase,
                sourceSha,
                fixtureVersion: questComparisonFixture.fixtureVersion,
                frozenBrowserTime: questComparisonFixture.frozenBrowserTime,
                sampleJobs: 5,
                sampleEvents: 10,
                measurementVersion: 2,
                ...(productionBenchmark
                  ? {
                      productionBenchmark: true,
                      preloadMode: state.preloadMode,
                      productionBuild,
                      clockMode:
                        'Date-only fixture; native Performance and timers',
                      additionalReadiness:
                        'Native page-side UI/stream/fonts readiness plus two animation frames; no cross-navigation CDP differences are calculated'
                    }
                  : {}),
                driverReadiness: productionBenchmark
                  ? 'Both phases: the original visibility/stream/fonts assertions, then wait for the native page-side two-frame ready mark. Wall timing starts immediately before navigation and ends after this wait.'
                  : 'Both phases: page navigation, Quest heading, first job label, one phase-specific visibility assertion, identical synthetic-stream-ready wait, and fonts.ready. Timing starts immediately before navigation and ends after fonts.ready.',
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
          // Tracing overhead is diagnostic, not a production timing budget.
          if (!attributionTrace) {
            expect(measurement.navigationToReadyMs <= 15000).toBe(true)
            for (const elapsed of measurement.navigationToReadySamplesMs) {
              expect(elapsed <= 15000).toBe(true)
            }
          }
          expect(measurement.horizontalOverflowPx <= 1).toBe(true)
          expect(measurement.workspaceHorizontalOverflowPx <= 1).toBe(true)
        }
      }
    } finally {
      try {
        if (activeTrace) await activeTrace.stop()
      } finally {
        await page.raw.goto('about:blank')
        state.restore()
        if (cdp) await cdp.detach()
      }
    }
  }
)

// New inspector/result affordances have no equivalent in the old page. Keep
// their measured first-open cost visible, separately from the paired baseline.
if (
  process.env.SLIPWAY_QUEST_PRODUCTION_BENCHMARK === '1' &&
  process.env.SLIPWAY_QUEST_ATTRIBUTION_TRACE !== '1' &&
  process.env.SLIPWAY_QUEST_CAPTURE_PHASE !== 'before'
) {
  test(
    'Quest production assets expose first inspector and direct job run readiness',
    {
      browser: true,
      world: {
        name: 'configured-slipway',
        context: {
          deploymentTarget: {
            slug: 'quest-production-interactions',
            name: 'Northstar Commerce'
          }
        }
      }
    },
    async (context) => {
      const { page, login, world, expect, sails } = context
      const assert = require('node:assert/strict')
      const fs = require('node:fs')
      const path = require('node:path')
      assert.equal(sails.config.environment, 'test')
      assert.notEqual(process.env.NODE_ENV, 'production')
      assert.equal(sails.config.hooks.shipwright, false)
      assert.equal(sails.config.hooks.quest, false)
      assert.equal(sails.config.hooks.lookout, false)
      assert.equal(
        sails.config.datastores.observability.url,
        process.env.SLIPWAY_TEST_NATIVE_CONFIG
          ? JSON.parse(
              fs.readFileSync(process.env.SLIPWAY_TEST_NATIVE_CONFIG, 'utf8')
            ).datastores.observability.url
          : ':memory:'
      )
      const runId = 'synthetic-production-profile-run'
      const jobName = 'export-account-report'
      const state = await installQuestFixture(
        context,
        'after',
        (state) => {
          const run = {
            runId,
            jobName,
            state: 'completed',
            trigger: 'manual',
            actor: 'Synthetic benchmark',
            requestedAt: state.now - 1000,
            startedAt: state.now - 900,
            finishedAt: state.now,
            duration: 900,
            exitCode: 0,
            resultStatus: 'available'
          }
          state.workspace.runs = [run]
          state.details[runId] = {
            ...run,
            inputs: {},
            result: { status: 'available', value: [{ processed: 25 }] },
            error: null
          }
        },
        { clockMode: 'native-performance-advancing' }
      )
      await page.raw.addInitScript(
        ({ projectPath }) => {
          window.__questDeferredReady = null
          window.__questObserveDeferred = (kind, startMs) => {
            window.__questDeferredReady = null
            const observe = () => {
              const detail = document.querySelector(
                '[data-test="quest-job-detail"]'
              )
              const button = detail?.querySelector(
                '[data-test="quest-open-run"]'
              )
              const result = document.querySelector(
                '[data-test="quest-run-result"]'
              )
              const ready =
                kind === 'direct-run'
                  ? result?.getClientRects().length &&
                    result.textContent.includes('processed')
                  : detail?.getClientRects().length &&
                    detail.textContent.includes('Export account report') &&
                    button?.getClientRects().length &&
                    !button.disabled
              if (ready) {
                const readyMs = performance.now()
                performance.mark('quest-deferred-ready')
                window.__questDeferredReady = {
                  kind,
                  startMs,
                  readyMs,
                  elapsedMs: readyMs - startMs
                }
              } else requestAnimationFrame(observe)
            }
            requestAnimationFrame(observe)
          }
          if (location.pathname === projectPath) {
            const query = new URLSearchParams(location.search)
            if (query.has('run')) window.__questObserveDeferred('direct-run', 0)
            else if (query.has('job'))
              window.__questObserveDeferred('direct-job', 0)
          }
        },
        { projectPath: state.projectPath }
      )
      const observations = []
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
          for (let sample = 0; sample < 3; sample++) {
            for (const kind of ['job-click', 'direct-job', 'direct-run']) {
              if (kind === 'job-click') {
                await page.goto(state.projectPath)
                await expect(
                  page.raw.locator('[data-test="quest-workspace"]')
                ).toBeVisible()
                const trigger = page.raw.getByRole('button', {
                  name: 'View Export account report',
                  exact: true
                })
                await expect(trigger).toBeVisible()
                await page.raw.evaluate(() => document.fonts.ready)
                state.bootstrapMeasurements = []
                await trigger.evaluate((element) =>
                  element.addEventListener(
                    'click',
                    () =>
                      window.__questObserveDeferred(
                        'job-click',
                        performance.now()
                      ),
                    { capture: true, once: true }
                  )
                )
                await trigger.click()
              } else {
                state.bootstrapMeasurements = []
                await page.goto(
                  `${state.projectPath}?job=${jobName}${
                    kind === 'direct-run' ? `&run=${runId}` : ''
                  }`
                )
              }
              await page.raw.waitForFunction(() =>
                Number.isFinite(window.__questDeferredReady?.readyMs)
              )
              const detail = page.raw.locator('[data-test="quest-job-detail"]')
              await expect(detail).toBeVisible()
              if (kind === 'direct-run') {
                await expect(
                  page.raw.locator('[data-test="quest-run-result"]')
                ).toContainText('processed')
                await expect(
                  page.raw.locator('[data-test="quest-run-detail"]')
                ).toContainText('Completed')
              } else
                await expect(
                  detail.locator('[data-test="quest-open-run"]')
                ).toBeEnabled()
              const native = await page.raw.evaluate(() => {
                const ready = window.__questDeferredReady
                return {
                  ...ready,
                  navigation: performance
                    .getEntriesByType('navigation')[0]
                    .toJSON(),
                  resources: performance
                    .getEntriesByType('resource')
                    .filter(
                      (entry) =>
                        entry.startTime >= ready.startMs &&
                        entry.startTime <= ready.readyMs
                    )
                    .map((entry) => ({
                      ...entry.toJSON(),
                      name: new URL(entry.name).pathname
                    }))
                }
              })
              const geometry = await questBrowserMeasurements(page)
              expect(native.elapsedMs <= 15000).toBe(true)
              if (kind === 'job-click')
                expect(
                  native.resources.filter((entry) =>
                    /\.(?:js|css)$/.test(entry.name)
                  ).length
                ).toBe(0)
              expect(geometry.horizontalOverflowPx <= 1).toBe(true)
              expect(geometry.workspaceHorizontalOverflowPx <= 1).toBe(true)
              observations.push({
                capture: capture.name,
                sample,
                kind,
                native,
                bootstrap: state.bootstrapMeasurements,
                geometry
              })
              expect(state.mutationRequests).toEqual([])
            }
          }
        }
        const root = path.resolve('.tmp/screenshots/quest-comparison/after')
        fs.mkdirSync(root, { recursive: true })
        fs.writeFileSync(
          path.join(root, 'interaction-performance.json'),
          JSON.stringify(
            {
              sourceSha: require('node:child_process')
                .execFileSync('git', ['rev-parse', 'HEAD'], {
                  encoding: 'utf8'
                })
                .trim(),
              preloadMode: state.preloadMode,
              method:
                'After-only production assets, three samples per viewport/path each round; native advancing Date-only clock; real click or full direct navigation, DOM-ready sampled at animation frames',
              fixture:
                'Separate synthetic five-job/ten-legacy-event fixture plus one completed correlated result; zero job invocation',
              limitations: [
                'No equivalent old-page inspector; these are costs, not a before/after action regression claim',
                'Full reload per sample; route interception disables HTTP cache',
                'Resource list includes completed requests started between action/navigation and ready; raw initiator and size fields retained'
              ],
              observations
            },
            null,
            2
          ) + '\n'
        )
        expect(state.unexpectedRequests).toEqual([])
        expect(page).toHaveNoJavascriptErrors()
      } finally {
        await page.raw.goto('about:blank')
        state.restore()
      }
    }
  )
}

// END QUEST COMPARISON CAPTURE

async function captureQuestBrowserFailure(page, state, name) {
  const fs = require('node:fs')
  const path = require('node:path')
  const root = path.resolve(
    '.tmp/screenshots/quest-workspace-states/diagnostics'
  )
  fs.mkdirSync(root, { recursive: true })
  try {
    const browser = await page.raw.evaluate(() => {
      const bootstrap = document.querySelector('script[data-page="app"]')
      const payload = bootstrap ? JSON.parse(bootstrap.textContent) : null
      let instance = document.querySelector(
        '[data-test="quest-workspace"]'
      )?.__vueParentComponent
      while (instance && !('reviewOpen' in (instance.setupState || {})))
        instance = instance.parent
      const setup = instance?.setupState || {}
      const unwrap = (value) =>
        value && typeof value === 'object' && '__v_isRef' in value
          ? value.value
          : value
      const job = unwrap(setup.selectedJob)
      const workspace = unwrap(setup.live)
      const review = unwrap(setup.review)
      const asyncChildren = []
      const pending = instance?.subTree ? [instance.subTree] : []
      const seen = new Set()
      while (pending.length && seen.size < 2000) {
        const node = pending.pop()
        if (!node || typeof node !== 'object' || seen.has(node)) continue
        seen.add(node)
        const type = node.type
        const name = type?.__name || type?.name || ''
        if (/QuestRunDialog|AsyncComponentWrapper|^Dialog$/i.test(name)) {
          asyncChildren.push({
            name,
            async: !!type?.__asyncLoader,
            resolvedName:
              type?.__asyncResolved?.__name ||
              type?.__asyncResolved?.name ||
              null,
            mounted: !!node.component?.isMounted,
            open: typeof node.props?.open === 'boolean' ? node.props.open : null
          })
        }
        if (node.component?.subTree) pending.push(node.component.subTree)
        if (Array.isArray(node.children)) pending.push(...node.children)
        if (node.suspense?.activeBranch)
          pending.push(node.suspense.activeBranch)
      }
      const componentState = {
        found: !!instance,
        asyncChildren,
        name: instance?.type?.__name || instance?.type?.name,
        hasReview: !!review,
        reviewOpen: unwrap(setup.reviewOpen),
        selectedJob: job?.name,
        fresh: unwrap(setup.fresh),
        canInvoke:
          typeof setup.canInvoke === 'function' ? setup.canInvoke(job) : null,
        observedAt: workspace?.observedAt,
        browserNow: Date.now(),
        randomUUIDAvailable: typeof crypto.randomUUID === 'function',
        secureContext: window.isSecureContext
      }
      return {
        componentState,
        url: location.href,
        bootstrapUrl: payload?.url,
        component: payload?.component,
        headings: [...document.querySelectorAll('h1,h2')].map((node) =>
          node.textContent.trim()
        ),
        selectedJobs: [
          ...document.querySelectorAll(
            '[data-test="quest-job-row"] [aria-pressed="true"]'
          )
        ].map((node) => node.getAttribute('aria-label')),
        dialogs: document.querySelectorAll('dialog[open]').length,
        text: document.body.innerText.slice(0, 8000)
      }
    })
    const report = {
      ...browser,
      javascriptErrors: page.javascriptErrors.map(String),
      consoleErrors: page.consoleErrors.map(
        (entry) => entry.text || String(entry)
      ),
      unexpectedRequests: state.unexpectedRequests,
      infrastructureRequests: state.infrastructureRequests,
      infrastructureFailures: state.infrastructureFailures,
      fixtureErrors: state.fixtureErrors,
      scriptRequests: state.scriptRequests,
      scriptResponses: state.scriptResponses,
      scriptFailures: state.scriptFailures,
      consoleWarnings: (page.consoleMessages || [])
        .filter((entry) => ['warning', 'warn'].includes(entry.type))
        .map((entry) => entry.text || String(entry))
    }
    console.log(
      'QUEST_BROWSER_FAILURE_SNAPSHOT ' + JSON.stringify({ name, ...report })
    )
    fs.writeFileSync(
      path.join(root, `${name}.json`),
      JSON.stringify(report, null, 2) + '\n'
    )
    await page.screenshot(path.join(root, `${name}.png`), {
      animations: 'disabled',
      fullPage: false
    })
  } catch (error) {
    console.log('QUEST_BROWSER_FAILURE_CAPTURE_ERROR ' + String(error))
  }
}

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

async function emitQuestWorkspace(
  page,
  state,
  { refreshObservation = state.workspace.mode === 'resident' } = {}
) {
  if (state.clockMode === 'advancing' && refreshObservation)
    state.workspace.observedAt = await page.raw.evaluate(() => Date.now())
  await page.raw.evaluate(
    ({ workspace, refreshObservation }) =>
      window.__questEmitWorkspace(workspace, refreshObservation),
    { workspace: state.workspace, refreshObservation }
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
    // Clear restored action focus naturally for presentation shots only.
    // Keyboard-state captures retain the real focus indicator and tooltip.
    const detailHeading = page.raw
      .locator('#quest-run-detail-title:visible, #quest-job-title:visible')
      .first()
    const form = page.raw.locator('[data-test="quest-run-form"]')
    if (
      !name.startsWith('keyboard-') &&
      !(await form.isVisible()) &&
      (await detailHeading.isVisible())
    ) {
      await detailHeading.click()
    }
    if (capture.width === 390 && (await form.isVisible())) {
      await expect(form.getByRole('heading', { name: /^Run / })).toBeInViewport(
        { ratio: 1 }
      )
      await expect(
        form.getByText('Web / Production', { exact: true })
      ).toBeInViewport({ ratio: 1 })
      await expect(
        page.raw.locator('[data-test="quest-confirm-run"]')
      ).toBeInViewport({ ratio: 1 })
      await expect(
        form.getByRole('button', { name: /^(Cancel|Close and check Runs)$/ })
      ).toBeInViewport({ ratio: 1 })
      const fields = page.raw.locator('[data-test="quest-run-fields"]')
      const scrolling = await fields.evaluate((element) => {
        const original = element.scrollTop
        element.scrollTop = element.scrollHeight
        const bottom = element.scrollTop
        element.scrollTop = 0
        const top = element.scrollTop
        element.scrollTop = original
        return {
          clientHeight: element.clientHeight,
          scrollHeight: element.scrollHeight,
          overflowY: getComputedStyle(element).overflowY,
          range: bottom - top
        }
      })
      expect(scrolling.clientHeight > 0).toBe(true)
      if (scrolling.scrollHeight > scrolling.clientHeight + 1) {
        expect(['auto', 'scroll'].includes(scrolling.overflowY)).toBe(true)
        expect(scrolling.range > 0).toBe(true)
      }
    }
    await page.raw.evaluate(() => document.fonts.ready)
    await page.raw.mouse.move(0, 0)
    let fieldStyles
    if (name === 'typed-inputs') {
      // Klean supplies behavior; Quest must use Slipway's existing form tokens.
      // Assert actual rendered styles in both themes, not only class strings.
      fieldStyles = await form
        .locator(
          '[data-slot="input"], [data-slot="textarea"], [data-slot="select-trigger"]'
        )
        .evaluateAll((elements) =>
          elements.map((element) => {
            const style = getComputedStyle(element)
            return {
              slot: element.dataset.slot,
              backgroundColor: style.backgroundColor,
              borderTopWidth: style.borderTopWidth,
              borderRightWidth: style.borderRightWidth,
              borderBottomWidth: style.borderBottomWidth,
              borderLeftWidth: style.borderLeftWidth,
              borderBottomStyle: style.borderBottomStyle,
              borderRadius: style.borderRadius
            }
          })
        )
      expect(fieldStyles.length).toBe(5)
      for (const style of fieldStyles) {
        expect(style.backgroundColor).toBe('rgba(0, 0, 0, 0)')
        expect(style.borderTopWidth).toBe('0px')
        expect(style.borderRightWidth).toBe('0px')
        expect(style.borderLeftWidth).toBe('0px')
        expect(style.borderBottomWidth).toBe('1px')
        expect(style.borderBottomStyle).toBe('dashed')
        expect(style.borderRadius).toBe('0px')
      }
      await expect(form.locator('[data-slot="checkbox"]')).toHaveCount(2)
    }
    let runHeaderGeometry
    const runDetail = page.raw.locator('[data-test="quest-run-detail"]')
    if (
      capture.width === 390 &&
      !(await form.isVisible()) &&
      (await runDetail.isVisible())
    ) {
      runHeaderGeometry = await runDetail.evaluate((element) => {
        const title = element.querySelector('#quest-run-detail-title')
        const id = title.nextElementSibling.getBoundingClientRect()
        const header = title.parentElement.parentElement.getBoundingClientRect()
        const back = element.querySelector('[aria-label="Close run details"]')
        const actions = back.parentElement.getBoundingClientRect()
        const label = [...back.childNodes].find(
          (node) => node.nodeType === Node.TEXT_NODE && node.textContent.trim()
        )
        const range = document.createRange()
        range.selectNodeContents(label)
        return {
          idWidth: id.width,
          headerWidth: header.width,
          idBottom: id.bottom,
          actionsTop: actions.top,
          backLabelLines: [...range.getClientRects()].filter(
            (rect) => rect.width > 0
          ).length
        }
      })
      expect(runHeaderGeometry.backLabelLines).toBe(1)
      expect(runHeaderGeometry.actionsTop >= runHeaderGeometry.idBottom).toBe(
        true
      )
      expect(
        runHeaderGeometry.idWidth >= runHeaderGeometry.headerWidth - 33
      ).toBe(true)
    }
    let scheduleContrast
    if (
      ['scheduled-inputs', 'inactive-schedule', 'invalid-schedule'].includes(
        name
      )
    ) {
      scheduleContrast = await page.raw
        .locator('[data-test="quest-job-detail"] [data-value="schedule"] dd')
        .evaluateAll((elements) => {
          const canvas = document.createElement('canvas')
          canvas.width = canvas.height = 1
          const context = canvas.getContext('2d', { willReadFrequently: true })
          const luminance = ([r, g, b]) =>
            [r, g, b]
              .map((value) => {
                value /= 255
                return value <= 0.04045
                  ? value / 12.92
                  : ((value + 0.055) / 1.055) ** 2.4
              })
              .reduce(
                (sum, value, i) => sum + value * [0.2126, 0.7152, 0.0722][i],
                0
              )
          return elements.map((element) => {
            const ancestors = []
            for (let node = element; node; node = node.parentElement)
              ancestors.unshift(node)
            context.fillStyle = '#fff'
            context.fillRect(0, 0, 1, 1)
            for (const node of ancestors) {
              context.fillStyle = getComputedStyle(node).backgroundColor
              context.fillRect(0, 0, 1, 1)
            }
            const background = luminance(context.getImageData(0, 0, 1, 1).data)
            context.fillStyle = getComputedStyle(element).color
            context.fillRect(0, 0, 1, 1)
            const foreground = luminance(context.getImageData(0, 0, 1, 1).data)
            return {
              text: element.textContent.trim(),
              ratio:
                (Math.max(background, foreground) + 0.05) /
                (Math.min(background, foreground) + 0.05)
            }
          })
        })
      expect(scheduleContrast.length > 5).toBe(true)
      for (const value of scheduleContrast)
        expect(value.ratio >= 4.5).toBe(true)
    }
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
          clockOrigin: questComparisonFixture.frozenBrowserTime,
          clockMode:
            'advancing wall clock; same fixed origin as the base comparison',
          transport:
            'Synthetic JSON and EventSource; actual application rendering',
          captures: []
        }
    manifest.captures.push({
      name,
      viewport: capture,
      filename: `quest-${name}-${capture.name}.png`,
      geometry,
      ...(fieldStyles ? { fieldStyles } : {}),
      ...(runHeaderGeometry ? { runHeaderGeometry } : {}),
      ...(scheduleContrast ? { scheduleContrast } : {})
    })
    if (
      capture.width === 390 &&
      ['typed-inputs', 'run-again-review'].includes(name)
    ) {
      // Show the actual acknowledgement below the fold without changing CSS,
      // draft values, focus, or application state to manufacture a screenshot.
      await page.raw.locator('[data-test="quest-run-fields"]').hover()
      await page.raw.mouse.wheel(0, 2000)
      await expect(
        page.raw.locator('[data-test="quest-production-confirm"]')
      ).toBeInViewport({ ratio: 1 })
      await expect(form.getByRole('heading', { name: /^Run / })).toBeInViewport(
        { ratio: 1 }
      )
      await expect(
        page.raw.locator('[data-test="quest-confirm-run"]')
      ).toBeInViewport({ ratio: 1 })
      await expect(
        form.getByRole('button', { name: 'Cancel', exact: true })
      ).toBeInViewport({ ratio: 1 })
      await page.raw.mouse.move(0, 0)
      const bottomFilename = `quest-${name}-review-bottom-${capture.name}.png`
      await page.screenshot(path.join(root, bottomFilename), {
        animations: 'disabled',
        fullPage: false
      })
      manifest.captures.push({
        name: `${name}-review-bottom`,
        viewport: capture,
        filename: bottomFilename,
        geometry: await questBrowserMeasurements(page)
      })
      await page.raw.locator('[data-test="quest-run-fields"]').hover()
      await page.raw.mouse.wheel(0, -2000)
      await expect(page.raw.locator('#quest-input-0')).toBeInViewport({
        ratio: 1
      })
    }
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
    const rerun = {
      ...accepted,
      runId: 'synthetic-reviewed-rerun'
    }
    state.details[rerun.runId] = {
      ...state.details[accepted.runId],
      ...rerun
    }
    let logsRequests = 0
    state.api = async (route, path, request) => {
      if (
        path === 'jobs/export-account-report/run' &&
        request.method() === 'POST'
      ) {
        if (state.mutationRequests.length === 1) {
          observeInvocation()
          await acceptance
          state.workspace.runs = [accepted]
          await route.fulfill({ status: 202, json: { run: accepted } })
        } else {
          state.workspace.runs = [rerun, ...state.workspace.runs]
          await route.fulfill({ status: 202, json: { run: rerun } })
        }
        return true
      }
      if (path === `runs/${accepted.runId}/logs`) logsRequests++
      return false
    }
    try {
      await login.withPassword('genesisUser', page, {
        password: world.current.auth.genesisUserPassword
      })
      await page.raw.waitForURL('**/')
      await page.goto(`${state.projectPath}?job=export-account-report`)
      const opener = page.raw.locator(
        '[data-test="quest-job-detail"] [data-test="quest-open-run"]'
      )
      await expect(opener).toBeEnabled()
      await opener.focus()
      await expect(opener).toBeFocused()
      await page.raw.keyboard.press('Enter')
      const form = page.raw.locator('[data-test="quest-run-form"]')
      const confirm = page.raw.locator('[data-test="quest-confirm-run"]')
      await expect(form).toBeVisible()
      await expect(confirm).toBeDisabled()
      expect(state.mutationRequests).toEqual([])
      const account = page.raw.locator('#quest-input-0')
      await form.getByRole('button', { name: 'Close run dialog' }).focus()
      const unfocusedBorder = await account.evaluate(
        (element) => getComputedStyle(element).borderBottomColor
      )
      await account.focus()
      await expect(account).toBeFocused()
      const focusedBorder = await account.evaluate(
        (element) => getComputedStyle(element).borderBottomColor
      )
      expect(focusedBorder !== unfocusedBorder).toBe(true)
      // The shared checkbox must retain optional-field inclusion and omission.
      const includeNote = form.getByRole('checkbox', {
        name: 'Include',
        exact: true
      })
      await includeNote.check()
      await page.raw.locator('#quest-input-5').fill('synthetic-omitted-note')
      await includeNote.uncheck()
      await expect(page.raw.locator('#quest-input-5')).toHaveCount(0)
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
      await expect(includeNote).toBeDisabled()
      await expect(
        page.raw.locator('[data-test="quest-production-confirm"]')
      ).toBeDisabled()
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
      // Exercise the real browser clipboard and a real downloaded JSON file;
      // these actions must not fetch logs, raw output, or repeat the job.
      await page.raw
        .context()
        .grantPermissions(['clipboard-read', 'clipboard-write'])
      const actions = page.raw.locator(
        '[data-test="quest-result-actions-trigger"]'
      )
      await actions.click()
      await page.raw
        .locator('[data-test="quest-result-actions-copy-json"]')
        .click()
      await expect(
        page.raw.locator('[data-test="quest-result-action-feedback"]')
      ).toContainText('Copied result JSON')
      const copied = await page.raw.evaluate(() =>
        navigator.clipboard.readText()
      )
      expect(JSON.parse(copied)).toEqual(
        state.details[accepted.runId].result.value
      )
      await actions.click()
      const downloadPromise = page.raw.waitForEvent('download')
      await page.raw
        .locator('[data-test="quest-result-actions-export-json"]')
        .click()
      const download = await downloadPromise
      expect(download.suggestedFilename()).toBe('quest-result.json')
      const exported = require('node:fs').readFileSync(
        await download.path(),
        'utf8'
      )
      expect(JSON.parse(exported)).toEqual(
        state.details[accepted.runId].result.value
      )
      expect(exported.includes('Synthetic log text')).toBe(false)
      expect(state.mutationRequests.length).toBe(1)
      expect(logsRequests).toBe(0)
      await page.raw.context().clearPermissions()
      await page.raw.getByRole('tab', { name: 'Logs', exact: true }).click()
      await expect(detail).toContainText('Synthetic diagnostic warning')
      await expect(detail).toContainText('Completed')
      expect(logsRequests).toBe(1)
      await page.raw.getByRole('tab', { name: 'Result', exact: true }).click()
      await expect(
        page.raw.locator('[data-test="quest-run-result"]')
      ).not.toContainText('Synthetic log text')
      await page.raw.reload()
      await expect(detail).toContainText('Completed')
      expect(state.mutationRequests.length).toBe(1)

      // Run again only opens review. Cancelling preserves the completed run.
      const runAgain = detail.getByRole('button', {
        name: 'Run again',
        exact: true
      })
      await runAgain.click()
      await expect(form).toBeVisible()
      await expect(
        form.getByRole('heading', {
          name: 'Run Export account report',
          exact: true
        })
      ).toBeVisible()
      await expect(
        form.getByText('Web / Production', { exact: true })
      ).toBeVisible()
      await expect(page.raw.locator('#quest-input-0')).toHaveValue(
        submittedInputs.account
      )
      await expect(page.raw.locator('#quest-input-1')).toHaveValue('25')
      await expect(page.raw.locator('#quest-input-2')).toContainText('False')
      await expect(page.raw.locator('#quest-input-3')).toContainText('full')
      await expect(page.raw.locator('#quest-input-4')).toHaveValue(
        JSON.stringify(submittedInputs.filters, null, 2)
      )
      await expect(page.raw.locator('#quest-input-5')).not.toBeVisible()
      await expect(
        page.raw.locator('[data-test="quest-production-confirm"]')
      ).not.toBeChecked()
      await expect(confirm).toBeDisabled()
      expect(state.mutationRequests.length).toBe(1)
      await form.getByRole('button', { name: 'Cancel', exact: true }).click()
      await expect(form).not.toBeVisible()
      await expect(detail).toContainText('Completed')
      expect(new URL(page.raw.url()).searchParams.get('run')).toBe(
        accepted.runId
      )
      expect(state.mutationRequests.length).toBe(1)

      await runAgain.click()
      await expect(form).toBeVisible()
      await expect(page.raw.locator('#quest-input-0')).toHaveValue(
        submittedInputs.account
      )
      await expect(confirm).toBeDisabled()
      await captureQuestWorkspaceState(page, expect, 'run-again-review', form)
      expect(state.mutationRequests.length).toBe(1)
      await page.raw.locator('[data-test="quest-production-confirm"]').check()
      await confirm.click()
      await expect(form).not.toBeVisible()
      await expect(detail).toContainText('Accepted')
      expect(state.mutationRequests.length).toBe(2)
      const rerunRequest = state.mutationRequests[1].body
      expect(rerunRequest.jobInputs).toEqual(submittedInputs)
      expect(rerunRequest.priorRunId).toBe(accepted.runId)
      expect(rerunRequest.runtimeId).toBe('synthetic-runtime-v1')
      expect(rerunRequest.metadataVersion).toBe('synthetic-metadata-v1')
      expect(rerunRequest.productionConfirmed).toBe(true)
      expect(typeof rerunRequest.requestId).toBe('string')
      expect(rerunRequest.requestId.length > 10).toBe(true)
      expect(rerunRequest.requestId !== request.requestId).toBe(true)
      expect(new URL(page.raw.url()).searchParams.get('run')).toBe(rerun.runId)
      // The prior result remains addressable and refresh never replays a POST.
      await page.goto(
        `${state.projectPath}?job=export-account-report&run=${accepted.runId}`
      )
      await expect(detail).toContainText('Completed')
      await expect(
        page.raw.locator('[data-test="quest-run-result"]')
      ).toContainText('processed')
      await page.raw.reload()
      await expect(detail).toContainText('Completed')
      expect(state.mutationRequests.length).toBe(2)
      expect(state.unexpectedRequests).toEqual([])
      expect(page).toHaveNoJavascriptErrors()
    } catch (error) {
      await captureQuestBrowserFailure(page, state, 'typed-inputs')
      throw error
    } finally {
      releaseAcceptance()
      await page.raw.goto('about:blank')
      state.restore()
    }
  }
)

test(
  'Quest distinguishes effective scheduled inputs from one-run overrides and inactive timers',
  {
    browser: true,
    world: {
      name: 'configured-slipway',
      context: {
        deploymentTarget: {
          slug: 'quest-scheduled-inputs',
          name: 'Northstar Commerce'
        }
      }
    }
  },
  async (context) => {
    const { page, login, world, expect } = context
    const state = await installQuestFixture(context, 'after', (state) => {
      configureTypedQuestJob(state)
      const job = state.workspace.jobs.find(
        (job) => job.name === 'export-account-report'
      )
      job.schedule = '1 hour'
      job.scheduleType = 'interval'
      job.scheduled = true
      job.nextRunAt = state.now + 3600000
      job.scheduleState = {
        registration: 'registered',
        validation: 'valid',
        validationErrors: [],
        reason: null,
        lastAttemptAt: new Date(state.now).toISOString(),
        restart: {
          persistence: 'memory_only',
          timing: 'relative_to_registration',
          oneShot: false,
          missedRuns: 'not_replayed'
        }
      }
      job.inputs.push({
        name: 'apiToken',
        friendlyName: 'API token',
        type: 'string',
        required: true,
        sensitive: true
      })
      job.scheduledInputs = {
        validation: 'not_checked',
        limitBytes: 16384,
        values: { limit: 25, dryRun: false, format: 'full', filters: null },
        fields: {
          account: {
            source: 'omitted',
            sensitive: false,
            available: false,
            missingRequired: true
          },
          limit: {
            source: 'job_input',
            sensitive: false,
            available: true,
            missingRequired: false
          },
          dryRun: {
            source: 'script_input',
            sensitive: false,
            available: true,
            missingRequired: false
          },
          format: {
            source: 'script_input',
            sensitive: false,
            available: true,
            missingRequired: false
          },
          filters: {
            source: 'schema_default',
            sensitive: false,
            available: true,
            missingRequired: false
          },
          note: {
            source: 'omitted',
            sensitive: false,
            available: false,
            missingRequired: false
          },
          apiToken: {
            source: 'job_input',
            sensitive: true,
            available: false,
            missingRequired: false,
            reason: 'sensitive'
          }
        }
      }
    })
    try {
      await login.withPassword('genesisUser', page, {
        password: world.current.auth.genesisUserPassword
      })
      await page.raw.waitForURL('**/')
      await page.goto(`${state.projectPath}?job=export-account-report`)
      const detail = page.raw.locator('[data-test="quest-job-detail"]')
      await detail.getByRole('tab', { name: 'Schedule', exact: true }).click()
      await expect(detail).toContainText(
        'Missing required scheduled inputs: account'
      )
      await expect(detail).toContainText(
        'Sails validates these values when the job runs'
      )
      await expect(detail).toContainText('Job input')
      await expect(detail).toContainText('Script input')
      await expect(detail).toContainText('Schema default')
      await expect(detail).toContainText('false')
      await expect(detail).toContainText('null')
      await expect(detail).toContainText('••••••')
      await captureQuestWorkspaceState(page, expect, 'scheduled-inputs', detail)
      const opener = detail.locator('[data-test="quest-open-run"]')
      await expect(opener).toBeEnabled()
      await opener.click()
      const form = page.raw.locator('[data-test="quest-run-form"]')
      await expect(page.raw.locator('#quest-input-1')).toHaveValue('25')
      await expect(page.raw.locator('#quest-input-2')).toContainText('False')
      await expect(page.raw.locator('#quest-input-3')).toContainText('full')
      await expect(page.raw.locator('#quest-input-4')).toHaveValue('null')
      await expect(page.raw.locator('#quest-input-6')).toHaveCount(0)
      await expect(form).toContainText('Uses the app’s source value.')
      const tokenOverride = form
        .locator('label[for="quest-input-6"]')
        .locator('..')
        .getByRole('checkbox', { name: 'Override', exact: true })
      await tokenOverride.check()
      await expect(page.raw.locator('#quest-input-6')).toHaveAttribute(
        'type',
        'password'
      )
      await expect(page.raw.locator('#quest-input-6')).toHaveValue('')
      await tokenOverride.uncheck()
      await page.raw.locator('#quest-input-1').fill('26')
      await form.getByRole('button', { name: 'Cancel', exact: true }).click()
      await expect(form).not.toBeVisible()
      expect(
        state.workspace.jobs.find((job) => job.name === 'export-account-report')
          .scheduledInputs.values.limit
      ).toBe(25)
      expect(state.mutationRequests.length).toBe(0)
      const job = state.workspace.jobs.find(
        (job) => job.name === 'export-account-report'
      )
      job.scheduled = false
      job.nextRunAt = null
      job.scheduleState.registration = 'stopped'
      await emitQuestWorkspace(page, state)
      await expect(detail).toContainText('Inactive')
      await expect(detail).toContainText('No timer registered')
      await captureQuestWorkspaceState(
        page,
        expect,
        'inactive-schedule',
        detail
      )
      job.scheduleState = {
        ...job.scheduleState,
        registration: 'failed',
        validation: 'invalid',
        validationErrors: [
          {
            code: 'E_SCHEDULE_INTERVAL',
            message: 'The source interval is invalid.'
          }
        ]
      }
      await emitQuestWorkspace(page, state)
      await expect(
        detail.locator('[data-test="quest-invalid-schedule"]')
      ).toContainText('The source interval is invalid.')
      await expect(opener).toBeEnabled()
      await expect(detail).toContainText(
        'Manual runs still use the job’s input validation.'
      )
      await captureQuestWorkspaceState(page, expect, 'invalid-schedule', detail)
      expect(state.mutationRequests.length).toBe(0)
      expect(state.unexpectedRequests).toEqual([])
      expect(page).toHaveNoJavascriptErrors()
    } catch (error) {
      await captureQuestBrowserFailure(page, state, 'scheduled-inputs')
      throw error
    } finally {
      await page.raw.goto('about:blank')
      state.restore()
    }
  }
)

test(
  'Quest refreshes richer evidence for a selected run outside the current history page without replay',
  {
    browser: true,
    world: {
      name: 'configured-slipway',
      context: {
        deploymentTarget: {
          slug: 'quest-enriched-receipt',
          name: 'Northstar Commerce'
        }
      }
    }
  },
  async (context) => {
    const { page, login, world, expect } = context
    const runId = 'synthetic-older-terminal'
    const state = await installQuestFixture(context, 'after', (state) => {
      configureTypedQuestJob(state)
      state.workspace.runs = Array.from({ length: 25 }, (_, index) =>
        syntheticQuestRun(state, `synthetic-newer-${index}`, {
          requestedAt: state.now - index,
          updatedAt: state.now
        })
      )
      state.details[runId] = {
        ...syntheticQuestRun(state, runId, {
          requestedAt: state.now - 100000,
          startedAt: state.now - 99900,
          finishedAt: state.now - 99000,
          updatedAt: state.now - 50
        }),
        inputs: {},
        result: { status: 'available', value: { processed: 1 } },
        deploymentId: 'synthetic-deployment',
        runtimeId: 'synthetic-runtime-v1'
      }
      state.logs[runId] = {
        stdout: 'short tail',
        stderr: '',
        truncated: true,
        available: true
      }
    })
    let detailReads = 0
    state.api = async (_route, path, request) => {
      if (
        path === `runs/${runId}` &&
        request.method() === 'GET' &&
        new URL(request.url()).searchParams.get('summaryOnly') !== 'true'
      )
        detailReads++
      return false
    }
    try {
      await login.withPassword('genesisUser', page, {
        password: world.current.auth.genesisUserPassword
      })
      await page.raw.waitForURL('**/')
      await page.goto(
        `${state.projectPath}?job=export-account-report&run=${runId}`
      )
      const detail = page.raw.locator('[data-test="quest-run-detail"]')
      await expect(detail).toContainText('Completed')
      await detail.getByRole('tab', { name: 'Logs', exact: true }).click()
      await expect(detail).toContainText('short tail')
      const beforeEnrichment = detailReads
      state.details[runId].inputs = {
        account: 'recovered-account',
        limit: 25,
        dryRun: false,
        format: 'full',
        filters: { region: 'eu' }
      }
      state.details[runId].updatedAt++
      state.logs[runId] = {
        stdout: 'expanded retained content; short tail',
        stderr: 'retained warning',
        truncated: false,
        available: true
      }
      await emitQuestWorkspace(page, state)
      await expect(detail).toContainText('recovered-account')
      await expect(detail).toContainText(
        'expanded retained content; short tail'
      )
      await expect(detail).toContainText('retained warning')
      expect(detailReads > beforeEnrichment).toBe(true)
      await detail.getByRole('tab', { name: 'Result', exact: true }).click()
      state.details[runId].inputs.note = 'second receipt revision'
      state.details[runId].updatedAt++
      state.logs[runId].stdout =
        'refreshed hidden log cache; expanded retained content; short tail'
      await emitQuestWorkspace(page, state)
      await expect(detail).toContainText('second receipt revision')
      await detail.getByRole('tab', { name: 'Logs', exact: true }).click()
      await expect(detail).toContainText('refreshed hidden log cache')
      const enrichedReads = detailReads
      const summaryResponse = page.raw.waitForResponse((response) =>
        response.url().includes(`/runs/${runId}?summaryOnly=true`)
      )
      await emitQuestWorkspace(page, state)
      await summaryResponse
      await page.raw.evaluate(
        () =>
          new Promise((resolve) =>
            requestAnimationFrame(() => requestAnimationFrame(resolve))
          )
      )
      expect(detailReads).toBe(enrichedReads)
      await captureQuestWorkspaceState(page, expect, 'enriched-logs', detail)
      await detail
        .getByRole('button', { name: 'Run again', exact: true })
        .click()
      const form = page.raw.locator('[data-test="quest-run-form"]')
      await expect(page.raw.locator('#quest-input-0')).toHaveValue(
        'recovered-account'
      )
      await expect(page.raw.locator('#quest-input-1')).toHaveValue('25')
      await form.getByRole('button', { name: 'Cancel', exact: true }).click()
      expect(state.mutationRequests.length).toBe(0)
      expect(state.unexpectedRequests).toEqual([])
      expect(page).toHaveNoJavascriptErrors()
    } catch (error) {
      await captureQuestBrowserFailure(page, state, 'enriched-receipt')
      throw error
    } finally {
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
      await page.raw.waitForURL('**/')
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
        if (failure === 'http') {
          const rejectedKey = state.mutationRequests.at(-1).body.requestId
          await confirm.click()
          await expect(confirm).toBeEnabled()
          expect(
            state.mutationRequests.at(-1).body.requestId !== rejectedKey
          ).toBe(true)
        }
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
      expect(state.mutationRequests.length).toBe(5)
      await page.raw.reload()
      await expect(
        page.raw.locator('[data-test="quest-workspace"]')
      ).toBeVisible()
      await expect(page.raw.locator('[data-test="quest-run-row"]')).toHaveCount(
        0
      )
      expect(state.mutationRequests.length).toBe(5)
      expect(state.unexpectedRequests).toEqual([])
      expect(page).toHaveNoJavascriptErrors()
    } catch (error) {
      await captureQuestBrowserFailure(page, state, 'request-failure')
      throw error
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
      ['undefined', { status: 'undefined' }, 'Return value: undefined.'],
      [
        'unsupported',
        { status: 'unsupported' },
        'This return value is not supported.'
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
      ['unavailable', { status: 'unavailable' }, 'Return value unavailable.']
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
      await page.raw.waitForURL('**/')
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
          await expect(detail).toContainText('Process exit 0')
          await expect(detail).toContainText('Named exit: invalid')
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
    } catch (error) {
      await captureQuestBrowserFailure(page, state, 'result-detail')
      throw error
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
      await page.raw.waitForURL('**/')
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
      await expect(opener).toBeFocused()
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
        window.__questObservationPaused = true
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
    } catch (error) {
      await captureQuestBrowserFailure(page, state, 'reconnect')
      throw error
    } finally {
      await page.raw.goto('about:blank')
      state.restore()
    }
  }
)

test(
  'Quest filters use established Slipway fields with visible focus and keyboard filtering',
  {
    browser: true,
    world: {
      name: 'configured-slipway',
      context: {
        deploymentTarget: {
          slug: 'quest-filter-fields',
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
      await page.raw.waitForURL('**/')
      await page.goto(state.projectPath)
      const search = page.raw.getByRole('searchbox', {
        name: 'Search jobs',
        exact: true
      })
      const filter = page.raw.getByRole('combobox', {
        name: 'Filter jobs by state',
        exact: true
      })
      const phase = process.env.SLIPWAY_QUEST_FILTER_CAPTURE_PHASE || 'after'
      for (const width of [1440, 390]) {
        await page.resize(width, 900)
        for (const scheme of ['light', 'dark']) {
          if (scheme === 'dark') await page.inDarkMode()
          else await page.inLightMode()
          await search.focus()
          await expect(search).toBeFocused()
          const style = await search.evaluate((element) => {
            const style = getComputedStyle(element)
            return {
              top: style.borderTopWidth,
              left: style.borderLeftWidth,
              right: style.borderRightWidth,
              bottom: style.borderBottomWidth,
              bottomStyle: style.borderBottomStyle,
              borderColor: style.borderBottomColor,
              outlineStyle: style.outlineStyle,
              radius: style.borderRadius
            }
          })
          if (phase === 'after') {
            expect(style.top).toBe('0px')
            expect(style.left).toBe('0px')
            expect(style.right).toBe('0px')
            expect(style.bottom).toBe('1px')
            expect(style.bottomStyle).toBe('dashed')
            expect(style.borderColor).toBe('rgb(2, 132, 199)')
            expect(style.outlineStyle).toBe('none')
            expect(style.radius).toBe('0px')
          }
          await page.screenshot(
            `.tmp/sounding/artifacts/quest-filter-review/${phase}-${width}-${scheme}.png`
          )
          const box = await search.boundingBox()
          expect(box.width > 100 && box.x + box.width <= width).toBe(true)
          await search.fill('catalog')
          await expect(
            page.raw.locator('[data-test="quest-job-row"]')
          ).toHaveCount(1)
          await search.fill('')
        }
      }
      await filter.focus()
      await filter.press('Enter')
      await expect(page.raw.getByRole('listbox')).toBeVisible()
      await filter.press('p')
      await filter.press('Enter')
      await expect(page.raw.locator('[data-test="quest-job-row"]')).toHaveCount(
        1
      )
      await expect(filter).toContainText('Paused')
      await expect(filter).toBeFocused()
      if (phase === 'after') {
        await page.raw.getByRole('tab', { name: 'Runs', exact: true }).click()
        const runJob = page.raw.getByRole('combobox', {
          name: 'Filter runs by job',
          exact: true
        })
        const runState = page.raw.getByRole('combobox', {
          name: 'Filter runs by state',
          exact: true
        })
        for (const width of [1440, 390]) {
          await page.resize(width, 900)
          for (const scheme of ['light', 'dark']) {
            await page.raw.emulateMedia({ colorScheme: scheme })
            for (const field of [runJob, runState]) {
              await field.focus()
              await expect(field).toBeFocused()
              // Select uses the app's 150ms color transition. Assert its
              // settled focus color before inspecting the full geometry.
              await expect(field).toHaveCSS(
                'border-bottom-color',
                'rgb(2, 132, 199)'
              )
              const style = await field.evaluate((element) => {
                const css = getComputedStyle(element)
                return {
                  top: css.borderTopWidth,
                  left: css.borderLeftWidth,
                  right: css.borderRightWidth,
                  bottom: css.borderBottomWidth,
                  style: css.borderBottomStyle,
                  color: css.borderBottomColor,
                  radius: css.borderRadius,
                  outline: css.outlineStyle
                }
              })
              expect(style).toEqual({
                top: '0px',
                left: '0px',
                right: '0px',
                bottom: '1px',
                style: 'dashed',
                color: 'rgb(2, 132, 199)',
                radius: '0px',
                outline: 'none'
              })
            }
            await page.screenshot(
              `.tmp/sounding/artifacts/quest-design-review/after-runs-${width}-${scheme}.png`
            )
          }
        }
        await runJob.press('Enter')
        await expect(page.raw.getByRole('listbox')).toBeVisible()
        await runJob.press('e')
        await runJob.press('Enter')
        await expect(runJob).toContainText('Export account report')
        await expect(runJob).toBeFocused()
        await page.goto(`${state.projectPath}?job=export-account-report`)
        await page.raw
          .locator(
            '[data-test="quest-job-detail"] [data-test="quest-open-run"]'
          )
          .click()
        const account = page.raw.locator('#quest-input-0')
        for (const width of [1440, 390]) {
          await page.resize(width, 900)
          for (const scheme of ['light', 'dark']) {
            await page.raw.emulateMedia({ colorScheme: scheme })
            await account.focus()
            await expect(account).toBeFocused()
            for (const id of ['#quest-input-2', '#quest-input-3']) {
              await expect(page.raw.locator(id)).toHaveCSS(
                'color',
                scheme === 'dark' ? 'rgb(255, 255, 255)' : 'rgb(23, 23, 23)'
              )
            }
            const style = await account.evaluate((element) => {
              const css = getComputedStyle(element)
              return {
                style: css.borderBottomStyle,
                color: css.borderBottomColor,
                outline: css.outlineStyle
              }
            })
            expect(style).toEqual({
              style: 'dashed',
              color: 'rgb(2, 132, 199)',
              outline: 'none'
            })
            await page.screenshot(
              `.tmp/sounding/artifacts/quest-design-review/after-inputs-${width}-${scheme}.png`
            )
          }
        }
      }
      // This synthetic fixture intentionally blocks development HMR sockets.
      expect(page).toHaveNoJavascriptErrors()
      expect(state.unexpectedRequests).toEqual([])
      expect(
        page.consoleErrors.filter(
          (entry) => !/rsbuild|WebSocket connection/.test(entry.text)
        )
      ).toEqual([])
    } finally {
      state.restore()
    }
  }
)
