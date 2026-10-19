const { test } = require('sounding')
const fs = require('node:fs')
const path = require('node:path')
const { prepare } = require('../../support/recovery-fixture')

test(
  'rollback UI offers only the available previous healthy image and reviews compatibility limits',
  {
    browser: true,
    world: {
      name: 'configured-slipway',
      context: { deploymentTarget: { slug: 'rollback-browser-proof' } }
    }
  },
  async ({ sails, page, world, login, expect }) => {
    const setup = await prepare({ sails, world })
    const project = world.current.projects.deploymentTarget
    const url = (id) => `/projects/${project.slug}/deployments/${id}`
    try {
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
        expect(actionBox.x >= 0 && actionBox.x + actionBox.width <= width).toBe(
          true
        )
        await action.click()
        const review = page.raw.locator('[data-test="confirm-modal"]')
        await expect(review).toContainText(
          'Database schema, data, files and external effects are not reversed'
        )
        await expect(review).toContainText('schema-1')
        await page.raw.screenshot({
          path: path.join(output, `recovery-review-${width}-${theme}.png`),
          animations: 'disabled'
        })
        await review
          .getByRole('button', { name: 'Cancel', exact: true })
          .click()
      }
      let submitted
      let csrfHeader
      await page.raw.route(
        '**/environments/production/rollback',
        async (route) => {
          submitted = route.request().postDataJSON()
          csrfHeader = route.request().headers()['x-csrf-token']
          await route.fulfill({
            status: 202,
            json: { deployment: { id: setup.current.id } }
          })
        }
      )
      await action.click()
      await page.raw
        .locator('[data-test="confirm-modal"]')
        .getByRole('button', { name: 'Roll back', exact: true })
        .click()
      await page.raw.waitForURL((url) =>
        url.pathname.endsWith(`/deployments/${setup.current.id}`)
      )
      expect(submitted).toEqual({
        deploymentId: String(setup.previous.id),
        appSlug: setup.app.slug,
        expectedCurrent: String(setup.current.id)
      })
      expect(Boolean(csrfHeader)).toBe(true)
      setup.artifacts.delete(setup.previous.imageId)
      await page.goto(url(setup.previous.id))
      await expect(action).toHaveCount(0)
      await expect(
        page.raw.locator('[data-test="recovery-status"]')
      ).toContainText('unavailable')
      await page.raw.screenshot({
        path: path.join(output, 'recovery-unavailable-mobile-dark.png'),
        animations: 'disabled'
      })
      expect(page).toHaveNoJavascriptErrors()
    } finally {
      setup.restore()
    }
  }
)
