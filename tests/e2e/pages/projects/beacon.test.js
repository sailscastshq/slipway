const { test } = require('sounding')
const fs = require('node:fs')
const path = require('node:path')

test(
  'Beacon distinguishes empty coverage from examples on desktop and mobile',
  {
    browser: true,
    world: {
      name: 'configured-slipway',
      context: { deploymentTarget: { slug: 'beacon-preview', name: 'Harbor' } }
    }
  },
  async ({ world, sails, page, login, expect }) => {
    const errors = []
    page.raw.on('pageerror', (error) => errors.push(error.message))
    const root = '/projects/beacon-preview/environments/production/apps/web'
    const output = path.resolve('.tmp/screenshots/beacon')
    fs.mkdirSync(output, { recursive: true })
    await sails.models.environment
      .updateOne({ id: world.current.environments.production.id })
      .set({ domain: 'harbor.example.com' })
    await login.withPassword('genesisUser', page, {
      password: world.current.auth.genesisUserPassword
    })
    await page.raw.setViewportSize({ width: 1440, height: 1100 })
    await page.inDarkMode()
    await page.goto(root)
    await page.raw.getByRole('button', { name: 'Open app actions' }).click()
    await page.raw
      .getByRole('menuitem', { name: 'Beacon', exact: true })
      .click()
    await page.raw.waitForURL('**/beacon')
    await expect(
      page.raw.getByText('Independent checker not connected', { exact: true })
    ).toBeVisible()
    await expect(page.raw.locator('[data-test="beacon-status"]')).toHaveText(
      'Unknown'
    )
    await expect(
      page.raw.getByText('No response measured', { exact: true })
    ).toBeVisible()
    await page.screenshot(path.join(output, 'beacon-empty-desktop.png'), {
      fullPage: true,
      animations: 'disabled'
    })
    await page.raw.getByRole('link', { name: 'Explore example' }).click()
    await page.raw.setViewportSize({ width: 1440, height: 1440 })
    await expect(
      page.raw.getByText('Example preview', { exact: true })
    ).toBeVisible()
    await expect(page.raw.locator('[data-test="beacon-status"]')).toHaveText(
      'Up'
    )
    await expect(page.raw.locator('[data-slot="line-chart"]')).toBeVisible()
    await expect(
      page.raw.getByText(
        'Simulated observations. No checks are running against this app.',
        { exact: true }
      )
    ).toBeVisible()
    await page.screenshot(path.join(output, 'beacon-example-desktop.png'), {
      fullPage: true,
      animations: 'disabled'
    })
    await page.raw.getByRole('link', { name: 'Outage', exact: true }).click()
    await expect(page.raw.locator('[data-test="beacon-status"]')).toHaveText(
      'Down'
    )
    await page.raw.locator('summary').filter({ hasText: 'Ongoing' }).click()
    await expect(
      page.raw.getByText(/Waiting for two successful checks/)
    ).toBeVisible()
    await page.screenshot(path.join(output, 'beacon-outage-desktop.png'), {
      fullPage: true,
      animations: 'disabled'
    })
    await page.raw.setViewportSize({ width: 390, height: 844 })
    await page.raw
      .getByRole('link', { name: 'Missing checker', exact: true })
      .click()
    await expect(page.raw.locator('[data-test="beacon-status"]')).toHaveText(
      'Unknown'
    )
    await expect(
      page.raw.getByText('No fresh observation for at least 3 minutes.', {
        exact: true
      })
    ).toBeVisible()
    expect(
      await page.raw.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth
      )
    ).toBe(true)
    await page.screenshot(path.join(output, 'beacon-missing-mobile.png'), {
      fullPage: true,
      animations: 'disabled'
    })
    await page.raw.getByRole('link', { name: 'Back to your app' }).click()
    await expect(
      page.raw.getByText('Independent checker not connected', { exact: true })
    ).toBeVisible()
    await expect(
      page.raw.getByText('Example preview', { exact: true })
    ).toHaveCount(0)
    expect(errors).toEqual([])
  }
)
