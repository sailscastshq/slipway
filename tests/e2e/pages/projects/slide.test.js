const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { test } = require('sounding')

test(
  'deployment slide keeps pointer friction optional and pending state truthful',
  {
    browser: true,
    world: {
      name: 'configured-slipway',
      context: {
        deploymentTarget: {
          slug: 'klean-slide-deployment',
          name: 'Klean Slide deployment'
        }
      }
    }
  },
  async ({ sails, world, page, expect }) => {
    const current = world.current
    const project = current.projects.deploymentTarget
    const environment = current.environments.production
    const app = current.apps.web
    const originalAppsDir = sails.config.custom.slipwayAppsDir
    const appsRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'slipway-slide-'))
    const sourceRoot = path.join(appsRoot, project.slug)

    fs.mkdirSync(sourceRoot, { recursive: true })
    fs.writeFileSync(
      path.join(sourceRoot, 'package.json'),
      JSON.stringify({ name: 'slide-source', private: true })
    )
    sails.config.custom.slipwayAppsDir = appsRoot

    try {
      await sails.models.environment.updateOne({ id: environment.id }).set({
        isProduction: false,
        envVars: { SESSION_SECRET: 'sounding-slide-secret' }
      })

      await page.raw.route('**/api/v1/system/check-update', async (route) => {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ updateAvailable: false })
        })
      })
      await page.raw.addInitScript(() => {
        window.EventSource = class MockEventSource {
          constructor() {
            setTimeout(() => this.onopen?.(), 0)
          }

          close() {}
        }
      })

      let deploymentRequests = 0
      let announceFirstRequest
      const firstRequest = new Promise((resolve) => {
        announceFirstRequest = resolve
      })
      let releaseFirstRequest
      const firstRequestRelease = new Promise((resolve) => {
        releaseFirstRequest = resolve
      })

      await page.raw.route(
        `**/api/v1/projects/${project.slug}/environments/${environment.slug}/apps/${app.slug}/deploy`,
        async (route) => {
          deploymentRequests += 1
          if (deploymentRequests === 1) {
            announceFirstRequest()
            await firstRequestRelease
          }

          await route.fulfill({
            status: 503,
            contentType: 'application/json',
            body: JSON.stringify({ message: 'Deployment service unavailable' })
          })
        }
      )

      await page.goto('/login')
      const csrf = await page.raw.evaluate(
        () => window.__SLIPWAY_CSRF_TOKEN__ || ''
      )
      const loginResponse = await page.raw.request.post('/login', {
        headers: { 'x-csrf-token': csrf },
        form: {
          email: current.users.genesisUser.email,
          password: current.auth.genesisUserPassword
        }
      })
      if (!loginResponse.ok()) {
        throw new Error(
          `Browser session setup failed (${loginResponse.status()}): ${await loginResponse.text()}`
        )
      }
      await page.goto(
        `/projects/${project.slug}/environments/${environment.slug}/apps/${app.slug}`
      )

      const slide = page.raw.locator('[data-slot="slide"]')
      await expect(slide).toBeVisible()
      await expect(slide).toHaveAccessibleName('Slide to Production')
      await expect(slide).toHaveAttribute('data-slot', 'slide')
      await expect(slide).toHaveAttribute('type', 'button')

      const bounds = await slide.boundingBox()
      if (!bounds) throw new Error('Slide geometry was unavailable')

      await page.raw.mouse.move(bounds.x + 20, bounds.y + bounds.height / 2)
      await page.raw.mouse.down()
      await page.raw.mouse.move(bounds.x + bounds.width * 0.45, bounds.y + 20)
      await page.raw.mouse.up()
      expect(deploymentRequests).toBe(0)
      await expect(slide).toHaveAttribute('data-progress', 'start')
      await expect(slide).toBeFocused()

      await page.raw.mouse.move(bounds.x + 20, bounds.y + bounds.height / 2)
      await page.raw.mouse.down()
      await page.raw.mouse.move(bounds.x + bounds.width - 5, bounds.y + 20)
      await page.raw.mouse.up()
      await firstRequest

      expect(deploymentRequests).toBe(1)
      await expect(slide).toBeDisabled()
      await expect(slide).toHaveAttribute('aria-busy', 'true')
      await expect(slide).toHaveAttribute('data-progress', 'complete')
      await expect(slide).toContainText('Sliding to Production...')
      await expect(
        slide.locator('[data-slot="slide-thumb"] [data-slot="spinner"]')
      ).toBeVisible()

      await slide.press('Enter')
      expect(deploymentRequests).toBe(1)

      releaseFirstRequest()
      await expect(slide).toBeEnabled()
      await expect(slide).toContainText('Slide to Production')
      await expect(slide).toHaveAttribute('data-progress', 'start')
      await expect(slide).toBeFocused()

      const keyboardResponse = page.raw.waitForResponse(
        (response) =>
          response.request().method() === 'POST' &&
          new URL(response.url()).pathname ===
            `/api/v1/projects/${project.slug}/environments/${environment.slug}/apps/${app.slug}/deploy`
      )
      await slide.press('Enter')
      await keyboardResponse
      expect(deploymentRequests).toBe(2)
      await expect(slide).toBeEnabled()
      await expect(slide).toBeFocused()

      await page.goto(
        `/projects/${project.slug}/environments/${environment.slug}?apps=1`
      )
      await page.raw.locator(`[data-test="app-actions-${app.slug}"]`).click()

      const environmentSlide = page.raw
        .locator(`[data-test="app-action-menu-${app.slug}"]`)
        .locator('[data-slot="slide"]')
      await expect(environmentSlide).toBeVisible()
      await expect(environmentSlide).toHaveAccessibleName('Slide to Production')

      const environmentResponse = page.raw.waitForResponse(
        (response) =>
          response.request().method() === 'POST' &&
          new URL(response.url()).pathname ===
            `/api/v1/projects/${project.slug}/environments/${environment.slug}/apps/${app.slug}/deploy`
      )
      await environmentSlide.focus()
      await environmentSlide.press('Enter')
      await environmentResponse

      expect(deploymentRequests).toBe(3)
      await expect(environmentSlide).toBeEnabled()
      await expect(environmentSlide).toBeFocused()

      expect(page).toHaveNoJavascriptErrors()
    } finally {
      sails.config.custom.slipwayAppsDir = originalAppsDir
      fs.rmSync(appsRoot, { recursive: true, force: true })
    }
  }
)
