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
      window.__slipwayTestEventSources = []

      class SlipwayTestEventSource {
        constructor(url) {
          this.url = String(url)
          this.readyState = 0
          this.closed = false
          window.__slipwayTestEventSources.push(this)
          this.timer = window.setTimeout(() => {
            if (this.closed) return
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
          this.closed = true
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
    await page.inLightMode()
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
    const lightSurface = await viewer.evaluate(
      (element) => getComputedStyle(element).backgroundColor
    )
    await viewer.screenshot({
      path: path.resolve('.tmp/issue-434-log-viewer-desktop-light.png')
    })

    await page.inDarkMode()
    await page.wait(100)
    const darkSurface = await viewer.evaluate(
      (element) => getComputedStyle(element).backgroundColor
    )
    expect(lightSurface === darkSurface).toBe(false)
    await viewer.screenshot({
      path: path.resolve('.tmp/issue-434-log-viewer-desktop-dark.png')
    })

    await viewer.locator('[data-test="log-level-filter"]').click()
    await page.raw.getByRole('option', { name: /^Errors ·/ }).click()
    expect(
      await viewer
        .locator('[data-test="log-level-filter"]')
        .getAttribute('aria-expanded')
    ).toBe('false')
    expect(await viewer.locator('[data-test="log-event"]').count()).toBe(1)
    await expect(page).toSee('Timeout.<anonymous>')
    await viewer.screenshot({
      path: path.resolve('.tmp/issue-434-log-viewer-error-filter.png')
    })

    await page.raw.getByRole('listbox').waitFor({ state: 'hidden' })
    await viewer.locator('[data-test="log-level-filter"]').click()
    await page.raw.getByRole('option', { name: 'All · 5', exact: true }).click()

    await page.raw.evaluate(() => {
      const stream = window.__slipwayTestEventSources.find((candidate) =>
        candidate.url.includes('/logs/stream')
      )
      for (let index = 0; index < 40; index += 1) {
        stream.onmessage?.({
          data: JSON.stringify({
            log: `2026-08-10T08:43:${String(index).padStart(
              2,
              '0'
            )}.000Z info: follow proof ${index}`
          })
        })
      }
    })
    await page.raw.waitForFunction(() => {
      const viewport = document.querySelector('[data-test="log-viewport"]')
      return (
        viewport &&
        viewport.scrollHeight - viewport.scrollTop - viewport.clientHeight < 40
      )
    })
    expect(await page.raw.getByText('Live', { exact: true }).count()).toBe(1)

    await page.resize(390, 844)
    await page.wait(100)
    const viewportWidth = await viewer.evaluate((element) => ({
      client: element.clientWidth,
      scroll: element.scrollWidth
    }))
    expect(viewportWidth.scroll <= viewportWidth.client + 1).toBe(true)
    await viewer.screenshot({
      path: path.resolve('.tmp/issue-434-log-viewer-mobile-dark.png')
    })

    const logStreams = await page.raw.evaluate(() =>
      window.__slipwayTestEventSources
        .filter((stream) => stream.url.includes('/logs/stream'))
        .map((stream) => ({ closed: stream.closed }))
    )
    expect(logStreams).toEqual([{ closed: false }])

    await page.resize(1440, 900)
    await page.inLightMode()
    await page.goto('/bosun?logs=1')
    const bosunViewer = page.raw.locator('[data-test="log-viewer"]')
    await bosunViewer.waitFor()
    await page.raw.waitForFunction(
      () => document.querySelectorAll('[data-test="log-event"]').length === 5
    )
    expect(await page.raw.getByText('Live', { exact: true }).count()).toBe(1)
    await bosunViewer.screenshot({
      path: path.resolve('.tmp/issue-437-bosun-light.png')
    })

    await page.inDarkMode()
    await page.wait(100)
    await bosunViewer.screenshot({
      path: path.resolve('.tmp/issue-437-bosun-dark.png')
    })
    expect(page).toHaveNoJavascriptErrors()
  }
)

test(
  'deployment history keeps occurrence times and fills its log card',
  {
    browser: true,
    world: {
      name: 'configured-slipway',
      context: {
        deploymentTarget: {
          slug: 'timestamped-deployment-logs',
          name: 'Timestamped Deployment Logs'
        }
      }
    }
  },
  async ({ sails, world, login, page, expect }) => {
    const current = world.current
    const lines = Array.from(
      { length: 48 },
      (_, index) =>
        `2026-08-13T09:10:${String(index).padStart(
          2,
          '0'
        )}.120Z info: Deployment step ${index + 1}`
    )
    const deployment = await world.create('deployment').with({
      status: 'running',
      triggerType: 'manual',
      environment: current.environments.production.id,
      app: current.apps.web.id,
      triggeredBy: current.users.genesisUser.id,
      buildLogs: `${lines.join('\n')}\n`,
      deployLogs: '2026-08-13T09:11:00.340Z info: Deployment complete.\n',
      startedAt: Date.now() - 5000,
      finishedAt: Date.now()
    })
    await sails.models.app.updateOne({ id: current.apps.web.id }).set({
      currentDeployment: deployment.id
    })

    await login.withPassword('genesisUser', page, {
      password: current.auth.genesisUserPassword
    })
    await page.resize(1440, 900)
    await page.inLightMode()
    await page.goto(
      `/projects/${current.projects.deploymentTarget.slug}/deployments/${deployment.id}`
    )

    const card = page.raw.locator('[data-test="deployment-log-viewer"]')
    const viewer = card.locator('[data-test="log-viewer"]')
    const viewport = viewer.locator('[data-test="log-viewport"]')
    await viewer.waitFor()
    await expect(page).toSee('09:10:00.120')
    await expect(page).toSee('09:11:00.340')

    const desktopGeometry = await page.raw.evaluate(() => {
      const cardElement = document.querySelector(
        '[data-test="deployment-log-viewer"]'
      )
      const viewerElement = cardElement.querySelector(
        '[data-test="log-viewer"]'
      )
      const viewportElement = cardElement.querySelector(
        '[data-test="log-viewport"]'
      )
      const cardRect = cardElement.getBoundingClientRect()
      const viewerRect = viewerElement.getBoundingClientRect()
      const viewportRect = viewportElement.getBoundingClientRect()
      return {
        cardBottom: cardRect.bottom,
        viewerBottom: viewerRect.bottom,
        viewportBottom: viewportRect.bottom,
        viewportHeight: viewportRect.height
      }
    })
    expect(
      Math.abs(desktopGeometry.cardBottom - desktopGeometry.viewerBottom) < 2
    ).toBe(true)
    expect(
      Math.abs(desktopGeometry.viewerBottom - desktopGeometry.viewportBottom) <
        2
    ).toBe(true)
    expect(desktopGeometry.viewportHeight > 384).toBe(true)
    await card.screenshot({
      path: path.resolve('.tmp/issue-437-deployment-light.png')
    })

    await page.inDarkMode()
    await page.wait(100)
    await card.screenshot({
      path: path.resolve('.tmp/issue-437-deployment-dark.png')
    })

    await page.resize(390, 844)
    await page.wait(100)
    const mobileGeometry = await viewport.evaluate((element) => {
      const viewerElement = element.closest('[data-test="log-viewer"]')
      const toolbarElement = viewerElement.firstElementChild
      const viewerRect = viewerElement.getBoundingClientRect()
      const viewportRect = element.getBoundingClientRect()
      const toolbarRect = toolbarElement.getBoundingClientRect()
      return {
        toolbarBottom: toolbarRect.bottom,
        viewportTop: viewportRect.top,
        viewerBottom: viewerRect.bottom,
        viewportBottom: viewportRect.bottom
      }
    })
    expect(mobileGeometry.toolbarBottom <= mobileGeometry.viewportTop + 1).toBe(
      true
    )
    expect(
      Math.abs(mobileGeometry.viewerBottom - mobileGeometry.viewportBottom) < 2
    ).toBe(true)
    expect(page).toHaveNoJavascriptErrors()
  }
)
