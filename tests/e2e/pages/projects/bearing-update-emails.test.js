const { test } = require('sounding')
const fs = require('node:fs')
const path = require('node:path')

test(
  'Updates email checkbox defaults off and saves, rolls back, and works in an embedded mobile view',
  {
    browser: true,
    world: {
      name: 'configured-slipway',
      context: {
        deploymentTarget: {
          slug: 'email-checkbox-browser',
          name: 'Synthetic App'
        }
      }
    }
  },
  async ({ sails, world, page, expect }) => {
    const current = world.current
    const app = current.apps.web
    const environment = current.environments.production
    const project = current.projects.deploymentTarget
    await App.updateOne({ id: app.id }).set({ bearingEnabled: true })
    await sails.helpers.bearing.ensureAppSecret.with({
      appId: String(app.id),
      rotate: true
    })
    const space = await BearingSpace.create({
      publicSlug: 'email-checkbox-browser',
      app: app.id,
      createdBy: current.users.genesisUser.id
    }).fetch()
    const base = `/_slipway/bearing/host/${project.slug}/${environment.slug}/${app.slug}`
    await page.raw.route('**/bearing/**', async (route) => {
      const url = new URL(route.request().url())
      if (url.pathname.startsWith('/bearing/')) {
        url.pathname = base + url.pathname.slice('/bearing'.length)
        const response = await route.fetch({
          url: url.toString(),
          maxRedirects: 0
        })
        const headers = response.headers()
        if (headers.location?.startsWith('/bearing/'))
          headers.location = base + headers.location.slice('/bearing'.length)
        await route.fulfill({ response, headers })
      } else await route.continue()
    })
    await page.raw.route('**/_slipway/bearing/_assets/**', async (route) => {
      const url = new URL(route.request().url())
      url.pathname = url.pathname.replace('/_slipway/bearing/_assets', '')
      await route.continue({ url: url.toString() })
    })
    const root = path.resolve('.tmp/screenshots/issue-753')
    fs.mkdirSync(root, { recursive: true })
    await page.goto(`${base}/updates`)
    const checkbox = page.raw.getByRole('checkbox', { name: /Email me when/ })
    await expect(checkbox).not.toBeChecked()
    await expect(checkbox).toBeDisabled()
    await expect(
      page.raw.getByRole('link', { name: 'Sign in to choose' })
    ).toHaveAttribute('href', /surface=updates/)
    await page.screenshot(path.join(root, 'signed-out-desktop.png'), {
      fullPage: true
    })
    const participant = await BearingParticipant.create({
      participantKey: 'synthetic-fixture',
      hostUserId: 'synthetic-browser-customer',
      email: 'synthetic@example.test',
      emailVerifiedAt: Date.now(),
      firstSeenAt: Date.now(),
      lastSeenAt: Date.now(),
      space: space.id
    }).fetch()
    const code = await sails.helpers.bearing.issueLaunchCode.with({
      participantId: String(participant.id),
      appId: String(app.id)
    })
    await page.goto(
      `/_slipway/bearing/session?code=${code}&surface=updates&embedded=1`
    )
    // The test proxy does not intercept a redirect chain's second request.
    // Production Caddy owns that namespace; open its private renderer here.
    await page.goto(`${base}/updates?embedded=1`)
    await expect(checkbox).toBeEnabled()
    await expect(checkbox).not.toBeChecked()
    await checkbox.focus()
    await checkbox.press('Space')
    await expect(page.raw.getByRole('status')).toHaveText('Saved.')
    await page.raw.reload()
    await expect(checkbox).toBeChecked()
    await page.raw.route('**/*update-email-preference', (route) =>
      route.fulfill({
        status: 503,
        contentType: 'application/json',
        body: '{}'
      })
    )
    await checkbox.uncheck()
    await expect(page.raw.getByRole('status')).toContainText('Could not save')
    await expect(checkbox).toBeChecked()
    await page.raw.unroute('**/*update-email-preference')
    await checkbox.uncheck()
    await expect(page.raw.getByRole('status')).toHaveText('Saved.')
    await expect(checkbox).not.toBeChecked()
    await page.raw.setViewportSize({ width: 390, height: 700 })
    await page.screenshot(path.join(root, 'embedded-mobile-off.png'), {
      fullPage: true
    })
    await page.raw.emulateMedia({ colorScheme: 'dark' })
    await page.raw.evaluate(() =>
      document.documentElement.classList.add('dark')
    )
    await page.screenshot(path.join(root, 'embedded-mobile-dark.png'), {
      fullPage: true
    })
    expect(
      await BearingUpdateConsent.count({
        participant: participant.id,
        state: 'on'
      })
    ).toBe(1)
    expect(
      await BearingUpdateConsent.count({
        participant: participant.id,
        state: 'off'
      })
    ).toBe(1)
  }
)
