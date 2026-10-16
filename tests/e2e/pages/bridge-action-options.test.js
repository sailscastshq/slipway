const { test } = require('sounding')
const { setup } = require('../../support/bridge-action-options')
test(
  'native action picker supports one selected chip, email search and empty-selection protection',
  {
    browser: true,
    world: {
      name: 'configured-slipway',
      context: { deploymentTarget: { slug: 'picker-browser' } }
    }
  },
  async ({ sails, world, login, page, expect }) => {
    const state = await setup(sails, world)
    try {
      await page.raw.route('**/api/v1/system/check-update', (route) =>
        route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: '{"updateAvailable":false}'
        })
      )
      await login.withPassword('genesisUser', page, {
        password: world.current.auth.genesisUserPassword
      })
      await page.raw.waitForURL((url) => url.pathname !== '/login')
      await page.goto(
        '/projects/picker-browser/environments/production/bridge/submission/1'
      )
      await page.raw.getByRole('button', { name: /Actions for/ }).click()
      await page.raw
        .locator('[data-test=bridge-record-action-menu-sendDecision]')
        .click()
      const dialog = page.raw.getByRole('dialog')
      await dialog.getByLabel('Selection Mode', { exact: true }).click()
      await page.raw
        .getByRole('option', { name: 'selected', exact: true })
        .click()
      const submit = dialog.getByRole('button', {
        name: 'Send decision',
        exact: true
      })
      await expect(submit).toBeDisabled()
      const search = dialog.getByPlaceholder('Search by name or email')
      await search.fill('alex@example.com')
      await page.raw.getByRole('option', { name: /Alex/ }).click()
      await expect(
        dialog.getByRole('button', { name: 'Remove Alex' })
      ).toBeVisible()
      await expect(submit).toBeEnabled()
      expect(
        state.optionCalls.some((call) => call.q === 'alex@example.com')
      ).toBe(true)
      await page.raw.setViewportSize({ width: 390, height: 844 })
      const bounds = await dialog.boundingBox()
      expect(bounds.x >= 0 && bounds.x + bounds.width <= 390).toBe(true)
      await dialog.getByRole('button', { name: 'Remove Alex' }).click()
      await expect(submit).toBeDisabled()
      expect(state.calls.length).toBe(0)
      await dialog.getByRole('button', { name: 'Cancel', exact: true }).click()
      expect(page).toHaveNoSmoke()
    } finally {
      state.restore()
    }
  }
)
