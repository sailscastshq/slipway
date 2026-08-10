const path = require('node:path')
const { test } = require('sounding')

const sampleLogs = [
  '2026-08-10T08:42:04.112Z info: Sails lifted on port 1337',
  '2026-08-10T08:42:07.491Z GET /api/v1/courses 200 42ms',
  '2026-08-10T08:42:09.008Z warning: Email layout value was ignored',
  '2026-08-10T08:42:09.009Z In call to sendEmail(), layout is not a recognized input.',
  '2026-08-10T08:42:12.798Z POST /api/v1/lessons/upload 500 Error: EMAXBUFFER',
  '2026-08-10T08:42:12.799Z Note that this upload timed out before reaching its receiver.',
  '2026-08-10T08:42:12.800Z     at Timeout.<anonymous> (/app/node_modules/skipper/lib/Upstream.js:86:15)',
  '2026-08-10T08:42:12.801Z     at process.processTimers (node:internal/timers:521:7)',
  '2026-08-10T08:42:12.802Z     code: EMAXBUFFER',
  '2026-08-10T08:42:14.210Z debug: reconnecting upload receiver'
]

test(
  'platform logs stay readable, filter complete incidents, and fit mobile',
  {
    browser: true,
    world: {
      name: 'configured-slipway',
      context: {
        deploymentTarget: {
          slug: 'readable-platform-logs',
          name: 'Readable Platform Logs'
        }
      }
    }
  },
  async ({ world, login, page, expect }) => {
    await page.raw.addInitScript((logs) => {
      class SlipwayTestEventSource {
        constructor(url) {
          this.url = String(url)
          this.readyState = 0
          this.timer = window.setTimeout(() => {
            this.readyState = 1
            this.onopen?.({ type: 'open' })
            if (!this.url.includes('/logs/stream')) return

            for (const log of logs) {
              this.onmessage?.({ data: JSON.stringify({ log }) })
            }
          }, 40)
        }

        close() {
          window.clearTimeout(this.timer)
          this.readyState = 2
        }
      }

      window.EventSource = SlipwayTestEventSource
    }, sampleLogs)

    const current = world.current
    await login.withPassword('genesisUser', page, {
      password: current.auth.genesisUserPassword
    })
    await page.resize(1440, 900)
    await page.inDarkMode()
    await page.goto(
      `/projects/${current.projects.deploymentTarget.slug}/environments/${current.environments.production.slug}/apps/${current.apps.web.slug}?logs=1`
    )

    const viewer = page.raw.locator('[data-test="log-viewer"]')
    await viewer.waitFor()
    await page.raw.waitForFunction(
      () => document.querySelectorAll('[data-test="log-event"]').length === 5
    )

    await expect(page).toSee('EMAXBUFFER')
    await expect(page).toSee('process.processTimers')
    expect(
      await viewer
        .locator('[data-test="log-event"][data-level="error"]')
        .count()
    ).toBe(1)
    await viewer.screenshot({
      path: path.resolve('.tmp/issue-383-log-viewer-desktop-dark.png')
    })

    await viewer.locator('[data-test="log-level-filter"]').selectOption('error')
    expect(await viewer.locator('[data-test="log-event"]').count()).toBe(1)
    await expect(page).toSee('Timeout.<anonymous>')
    await viewer.screenshot({
      path: path.resolve('.tmp/issue-383-log-viewer-error-filter.png')
    })

    await viewer.locator('[data-test="log-level-filter"]').selectOption('all')
    await page.resize(390, 844)
    await page.wait(100)
    const viewportWidth = await viewer.evaluate((element) => ({
      client: element.clientWidth,
      scroll: element.scrollWidth
    }))
    expect(viewportWidth.scroll <= viewportWidth.client + 1).toBe(true)
    await viewer.screenshot({
      path: path.resolve('.tmp/issue-383-log-viewer-mobile-dark.png')
    })
    expect(page).toHaveNoJavascriptErrors()
  }
)

test(
  'deployment output uses the same safe incident viewer',
  {
    browser: true,
    world: {
      name: 'configured-slipway',
      context: {
        deploymentTarget: {
          slug: 'readable-deployment-logs',
          name: 'Readable Deployment Logs'
        }
      }
    }
  },
  async ({ sails, world, login, page, expect }) => {
    const current = world.current
    const deployment = await world.create('deployment').with({
      status: 'failed',
      triggerType: 'manual',
      triggeredBy: current.users.genesisUser.id,
      environment: current.environments.production.id,
      app: current.apps.web.id,
      buildLogs: [
        '#9 [5/6] RUN npm ci',
        '#9 DONE 18.2s',
        '#10 [6/6] COPY . .',
        '#10 DONE 0.2s'
      ].join('\n'),
      deployLogs: [
        '2026-08-10T08:42:12.798Z POST /api/v1/lessons/upload 500 Error: EMAXBUFFER',
        '2026-08-10T08:42:12.799Z Note that this upload timed out before reaching its receiver.',
        '2026-08-10T08:42:12.800Z     at Timeout.<anonymous> (/app/node_modules/skipper/lib/Upstream.js:86:15)',
        '2026-08-10T08:42:12.801Z     code: EMAXBUFFER'
      ].join('\n'),
      errorMessage: 'The upload receiver did not accept the file in time.',
      startedAt: Date.now() - 5000,
      finishedAt: Date.now()
    })

    await login.withPassword('genesisUser', page, {
      password: current.auth.genesisUserPassword
    })
    await page.resize(1440, 900)
    await page.inDarkMode()
    await page.goto(
      `/projects/${current.projects.deploymentTarget.slug}/deployments/${deployment.id}`
    )

    const deploymentLogs = page.raw.locator(
      '[data-test="deployment-log-viewer"]'
    )
    await deploymentLogs.waitFor()
    await expect(page).toSee('Complete')
    await expect(page).toSee('EMAXBUFFER')
    await expect(page).toSee('Timeout.<anonymous>')
    const renderedText = await deploymentLogs.textContent()
    expect(renderedText.includes('font-semibold">')).toBe(false)

    await deploymentLogs.screenshot({
      path: path.resolve('.tmp/issue-383-deployment-logs-after.png')
    })
    expect(page).toHaveNoJavascriptErrors()
  }
)
