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
        state.serverInitialRuntimeState =
          payload.props.workspace?.runtimeState || null
        state.serverInitialReason = payload.props.workspace?.reason || null
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

const fs = require('node:fs')
const path = require('node:path')
const reviewPhase = process.env.QUEST_LOADING_REVIEW_PHASE || 'after'

test(
  'Quest initial loading, reconnect and runtime replacement have measured browser evidence',
  {
    browser: true,
    world: {
      name: 'configured-slipway',
      context: {
        deploymentTarget: {
          slug: 'quest-loading-review',
          name: 'Northstar Commerce'
        }
      }
    }
  },
  async (context) => {
    const { login, world, page, expect } = context
    // Keep development HMR transport local to the fixture; Mac Chromium's
    // loopback access check otherwise reports unrelated socket errors.
    await page.raw.routeWebSocket(/\/rsbuild-hmr(?:\?|$)/, () => {})
    const state = await installQuestFixture(
      context,
      'after',
      (fixture) => {
        fixture.ready = JSON.parse(JSON.stringify(fixture.workspace))
        fixture.workspace = {
          ...fixture.workspace,
          mode: 'legacy',
          runtimeState: 'loading',
          observedAt: null,
          reason: null,
          target: { ...fixture.workspace.target, runtimeId: null },
          capabilities: {}
        }
      },
      { clockMode: 'native-performance-advancing' }
    )
    const root = path.resolve('.tmp/local-review/quest', reviewPhase)
    fs.mkdirSync(root, { recursive: true })
    const samples = []
    try {
      await login.withPassword('genesisUser', page, {
        password: world.current.auth.genesisUserPassword
      })
      await page.raw.waitForURL('**/')
      for (const width of [1440, 390]) {
        await page.resize(width, 1000)
        for (const scheme of ['light', 'dark']) {
          await (scheme === 'light' ? page.inLightMode() : page.inDarkMode())
          await page.raw.goto(state.projectPath)
          const workspace = page.raw.locator('[data-test="quest-workspace"]')
          await expect(workspace).toContainText('Rebuild search index')
          if (reviewPhase === 'after') {
            await expect(
              page.raw.locator('[data-test="quest-runtime-loading"]')
            ).toContainText('Loading jobs')
            await expect(
              workspace
                .locator('[data-slot=badge]')
                .filter({ hasText: /^Loading$/ })
                .first()
            ).toBeVisible()
          } else
            await expect(
              page.raw.locator('[data-test="quest-runtime-unavailable"]')
            ).toBeVisible()
          await page.screenshot(
            path.join(root, `${width}-${scheme}-initial.png`),
            { animations: 'disabled', fullPage: true }
          )
          const initial = await page.raw.evaluate(() => {
            const nav = performance.getEntriesByType('navigation')[0]
            return {
              measuredAtMs: performance.now(),
              responseMs: nav.responseStart - nav.requestStart,
              documentMs: nav.responseEnd - nav.startTime,
              domContentLoadedMs: nav.domContentLoadedEventEnd
            }
          })
          const received = await page.raw.evaluate((ready) => {
            const start = performance.now()
            window.__questStreamPayload = {
              workspace: {
                ...ready,
                observedAt: Date.now(),
                runtimeState: 'live'
              }
            }
            for (const stream of window.__questStreams)
              if (!stream.closed && stream.url.includes('/quest/stream'))
                stream.onmessage?.({
                  data: JSON.stringify(window.__questStreamPayload)
                })
            return start
          }, state.ready)
          await expect(
            page.raw.locator('[data-test="quest-stream-status"]')
          ).toContainText('Live')
          const firstObservationRenderMs = await page.raw.evaluate(
            (start) => performance.now() - start,
            received
          )
          await page.screenshot(
            path.join(root, `${width}-${scheme}-live.png`),
            { animations: 'disabled', fullPage: true }
          )
          samples.push({
            width,
            scheme,
            coldQuestBrowserRoute: samples.length === 0,
            initial,
            firstObservationRenderMs,
            serverBootstrap: state.bootstrapMeasurements.at(-1),
            serverInitialRuntimeState: state.serverInitialRuntimeState,
            serverInitialReason: state.serverInitialReason
          })
          if (reviewPhase === 'after') {
            await page.raw.evaluate(() => {
              window.__questStreamOnline = false
              window.__questObservationPaused = true
              for (const stream of window.__questStreams)
                if (!stream.closed && stream.url.includes('/quest/stream'))
                  stream.onerror?.({ type: 'error' })
            })
            await expect(
              page.raw.locator('[data-test="quest-stream-status"]')
            ).toContainText('Reconnecting')
            await expect(
              workspace
                .locator('[data-slot=badge]')
                .filter({ hasText: /^Unknown$/ })
                .first()
            ).toBeVisible()
            await page.screenshot(
              path.join(root, `${width}-${scheme}-reconnecting.png`),
              { animations: 'disabled', fullPage: true }
            )
            await page.raw.evaluate(() => {
              window.__questStreamOnline = true
              window.__questObservationPaused = false
            })
            await expect(
              page.raw.locator('[data-test="quest-stream-status"]')
            ).toContainText('Live', { timeout: 10000 })
            await page.raw.evaluate(() => {
              const next = {
                ...window.__questStreamPayload.workspace,
                target: {
                  ...window.__questStreamPayload.workspace.target,
                  runtimeId: 'replacement-runtime'
                },
                observedAt: Date.now()
              }
              window.__questStreamPayload = { workspace: next }
              for (const stream of window.__questStreams)
                if (!stream.closed && stream.url.includes('/quest/stream'))
                  stream.onmessage?.({
                    data: JSON.stringify(window.__questStreamPayload)
                  })
            })
            await expect(
              page.raw.locator('[data-test="quest-stream-status"]')
            ).toContainText('Live')
          }
        }
      }
      expect(state.mutationRequests).toEqual([])
      expect(state.unexpectedRequests).toEqual([])
      fs.writeFileSync(
        path.join(root, 'measurements.json'),
        JSON.stringify(
          {
            phase: reviewPhase,
            scope:
              'Actual local app/browser and initial server response; synthetic metadata and stream transport, no Docker or production workload measured.',
            samples
          },
          null,
          2
        )
      )
      expect(page).toHaveNoSmoke()
    } finally {
      state.restore()
    }
  }
)
