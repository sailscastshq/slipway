const { test } = require('sounding')
const fs = require('node:fs')
const path = require('node:path')
const { prepare, image } = require('../../support/recovery-fixture')

for (const legacy of [false, true])
  test(
    `${
      legacy ? 'legacy' : 'recorded'
    } rollback offers the verified image with explicit unknown-schema review`,
    {
      browser: true,
      world: {
        name: 'configured-slipway',
        context: {
          deploymentTarget: {
            slug: legacy
              ? 'legacy-rollback-browser-proof'
              : 'rollback-browser-proof'
          }
        }
      }
    },
    async ({ sails, page, world, login, expect }) => {
      const setup = await prepare({ sails, world, legacy })
      const project = world.current.projects.deploymentTarget
      const url = (id) => `/projects/${project.slug}/deployments/${id}`
      let rollbackRequests = 0
      let releaseFirstRequest
      let respondToRollback = (route) =>
        route.fulfill({
          status: 409,
          json: { message: 'Unexpected unconfirmed rollback' }
        })
      try {
        await page.raw.route(
          '**/environments/production/rollback',
          async (route) => {
            rollbackRequests++
            await respondToRollback(route)
          }
        )
        await page.raw.route('**/api/v1/system/check-update', (route) =>
          route.fulfill({ json: { updateAvailable: false } })
        )
        await login.withPassword('genesisUser', page, {
          password: world.current.auth.genesisUserPassword
        })
        await page.raw.waitForURL((url) => !url.pathname.startsWith('/login'))
        await page.goto(url(setup.previous.id))
        const action = page.raw.locator('[data-test="rollback-action"]')
        await expect(action).toBeVisible()
        await expect(
          page.raw.locator('[data-test="recovery-status"]')
        ).toContainText('Previous healthy release')
        const output = path.resolve('output/rollback-recovery')
        fs.mkdirSync(output, { recursive: true })
        for (const [width, theme] of [
          [1440, 'light'],
          [390, 'dark']
        ]) {
          await page.raw.setViewportSize({ width, height: 1100 })
          await page.raw.emulateMedia({ colorScheme: theme })
          const actionBox = await action.boundingBox()
          expect(
            actionBox.x >= 0 && actionBox.x + actionBox.width <= width
          ).toBe(true)
          await action.click()
          const review = page.raw.locator('[data-test="confirm-modal"]')
          await expect(review).toContainText(
            'Rollback does not undo database migrations'
          )
          await expect(review).toContainText(
            'Schema compatibility is unverified'
          )
          await expect(
            review.getByRole('button', {
              name: 'Slide to roll back',
              exact: true
            })
          ).toBeDisabled()
          await page.raw.screenshot({
            path: path.join(
              output,
              `${legacy ? 'legacy-' : ''}recovery-review-${width}-${theme}.png`
            ),
            animations: 'disabled'
          })
          await review
            .getByRole('checkbox', { name: /I confirm the previous app/ })
            .check()
          const slide = review.locator('[data-slot="slide"]')
          await expect(slide).toBeEnabled()
          const slideBox = await slide.boundingBox()
          expect(slideBox.x >= 0 && slideBox.x + slideBox.width <= width).toBe(
            true
          )
          await page.raw.screenshot({
            path: path.join(
              output,
              `${
                legacy ? 'legacy-' : ''
              }rollback-slide-ready-${width}-${theme}.png`
            ),
            animations: 'disabled'
          })
          await review
            .getByRole('button', { name: 'Cancel', exact: true })
            .click()
          expect(rollbackRequests).toBe(0)
        }
        let submitted
        let csrfHeader
        let announceFirstRequest
        const firstRequest = new Promise((resolve) => {
          announceFirstRequest = resolve
        })
        const firstResponseGate = new Promise((resolve) => {
          releaseFirstRequest = resolve
        })
        respondToRollback = async (route) => {
          submitted = route.request().postDataJSON()
          csrfHeader = route.request().headers()['x-csrf-token']
          if (rollbackRequests === 1) {
            announceFirstRequest()
            await firstResponseGate
            return route.fulfill({
              status: 409,
              json: { message: 'Recovery target changed; review it again.' }
            })
          }
          await route.fulfill({
            status: 202,
            json: { deployment: { id: setup.current.id } }
          })
        }
        await action.click()
        await page.raw
          .getByRole('checkbox', { name: /I confirm the previous app/ })
          .check()
        const review = page.raw.locator('[data-test="confirm-modal"]')
        const slide = review.locator('[data-slot="slide"]')
        await slide.click()
        expect(rollbackRequests).toBe(0)
        async function drag(fraction, escape = false) {
          const box = await slide.boundingBox()
          await page.raw.mouse.move(box.x + 20, box.y + box.height / 2)
          await page.raw.mouse.down()
          await page.raw.mouse.move(
            box.x + box.width * fraction,
            box.y + box.height / 2,
            { steps: 5 }
          )
          if (escape) await page.raw.keyboard.press('Escape')
          await page.raw.mouse.up()
        }
        await drag(0.45)
        expect(rollbackRequests).toBe(0)
        await drag(0.9, true)
        expect(rollbackRequests).toBe(0)
        await expect(review).toBeHidden()
        await action.click()
        await review
          .getByRole('checkbox', { name: /I confirm the previous app/ })
          .check()
        await slide.press('Enter')
        await firstRequest
        await expect(slide).toHaveAttribute('aria-busy', 'true')
        await expect(slide).toBeDisabled()
        await slide.press('Enter')
        expect(rollbackRequests).toBe(1)
        releaseFirstRequest()
        await expect(
          page.raw.getByText('Recovery target changed; review it again.', {
            exact: true
          })
        ).toBeVisible()
        await action.click()
        await expect(slide).toBeDisabled()
        await review
          .getByRole('checkbox', { name: /I confirm the previous app/ })
          .check()
        await drag(0.98)
        await page.raw.waitForURL((url) =>
          url.pathname.endsWith(`/deployments/${setup.current.id}`)
        )
        expect(submitted).toEqual({
          deploymentId: String(setup.previous.id),
          appSlug: setup.app.slug,
          expectedCurrent: String(setup.current.id),
          acknowledgeUnknownCompatibility: true
        })
        expect(Boolean(csrfHeader)).toBe(true)
        expect(rollbackRequests).toBe(2)
        setup.artifacts.delete(image(1))
        await page.goto(url(setup.previous.id))
        await expect(action).toHaveCount(0)
        await expect(
          page.raw.locator('[data-test="recovery-status"]')
        ).toContainText('unavailable')
        await page.raw.screenshot({
          path: path.join(
            output,
            `${legacy ? 'legacy-' : ''}recovery-unavailable-mobile-dark.png`
          ),
          animations: 'disabled'
        })
        expect(page).toHaveNoJavascriptErrors()
      } finally {
        releaseFirstRequest?.()
        setup.restore()
      }
    }
  )
