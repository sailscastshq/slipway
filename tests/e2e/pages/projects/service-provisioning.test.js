const { test } = require('sounding')
const provisioning = require('../../../../api/lib/service-provisioning')
const fs = require('node:fs')
const path = require('node:path')

test(
  'Retry setup appears only for eligible services and reports recovery errors without success',
  {
    browser: true,
    world: {
      name: 'configured-slipway',
      context: { deploymentTarget: { slug: 'provisioning-ui' } }
    }
  },
  async ({ world, login, page, expect }) => {
    const original = provisioning.eligibility
    provisioning.eligibility = async (service) => ({
      eligible: service.name === 'recoverable-db'
    })
    try {
      const eligible = await world.create('service').with({
        name: 'recoverable-db',
        status: 'creating',
        environment: world.current.environments.production.id
      })
      await world.create('service').with({
        name: 'active-db',
        status: 'creating',
        environment: eligible.environment
      })
      await login.withPassword('genesisUser', page, {
        password: world.current.auth.genesisUserPassword
      })
      await page.raw.waitForURL('**/')
      await page.goto('/projects/provisioning-ui/environments/production')
      await page.raw.getByRole('button', { name: /^Services 2$/ }).click()
      await page.raw
        .getByRole('button', { name: 'Actions for active-db', exact: true })
        .click()
      await expect(
        page.raw.getByRole('menuitem', {
          name: 'Retry setup',
          exact: true
        })
      ).toHaveCount(0)
      await page.raw.keyboard.press('Escape')
      await page.raw
        .getByRole('button', {
          name: 'Actions for recoverable-db',
          exact: true
        })
        .click()
      await page.raw.route(
        `**/api/v1/services/${eligible.id}/retry-provisioning`,
        (route) =>
          route.fulfill({
            status: 409,
            json: { message: 'The previous provisioner is still active.' }
          })
      )
      const retry = page.raw.getByRole('menuitem', {
        name: 'Retry setup',
        exact: true
      })
      await expect(retry).toHaveAccessibleDescription(
        'Retry provisioning for this service.'
      )
      await expect(retry.locator('svg')).toHaveAttribute('aria-hidden', 'true')
      fs.mkdirSync(path.resolve('output/issue-840'), { recursive: true })
      await page.raw.evaluate(
        () =>
          new Promise((resolve) =>
            requestAnimationFrame(() => requestAnimationFrame(resolve))
          )
      )
      await page.screenshot(
        path.resolve('output/issue-840/retry-setup-menu.png'),
        { animations: 'disabled' }
      )
      await page.raw
        .getByRole('menuitem', { name: 'Retry setup', exact: true })
        .click()
      const toasts = page.raw.locator(
        '[data-slot="toast"]:not([data-state="closing"])'
      )
      await expect(
        toasts.filter({ hasText: 'The previous provisioner is still active.' })
      ).toHaveCount(1)
      await expect(
        toasts.filter({ hasText: 'Provisioning failed for recoverable-db' })
      ).toHaveCount(1)
      await expect(
        toasts.filter({ hasText: 'Provisioned recoverable-db' })
      ).toHaveCount(0)
      expect(page).toHaveNoJavascriptErrors()
    } finally {
      provisioning.eligibility = original
    }
  }
)
