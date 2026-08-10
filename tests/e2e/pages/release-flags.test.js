const { test } = require('sounding')

test(
  'release flags stay minimal in the app and explain their impact in Lookout',
  {
    browser: true,
    world: {
      name: 'configured-slipway',
      context: {
        deploymentTarget: {
          slug: 'release-flags-ui',
          name: 'Release Flags UI'
        }
      }
    }
  },
  async ({ sails, world, login, page, expect }) => {
    const current = world.current
    const project = current.projects.deploymentTarget
    const environment = current.environments.production
    const app = current.apps.web
    await sails.models.featureflag.createEach([
      {
        key: 'new-checkout',
        description: 'Release the simpler checkout safely',
        enabled: true,
        rolloutPercentage: 25,
        targets: ['account:acme', 'user:42'],
        changedByName: current.users.genesisUser.fullName,
        changedBy: current.users.genesisUser.id,
        environment: environment.id,
        app: app.id
      },
      {
        key: 'faster-search',
        enabled: false,
        rolloutPercentage: 100,
        targets: [],
        changedByName: current.users.genesisUser.fullName,
        changedBy: current.users.genesisUser.id,
        environment: environment.id,
        app: app.id
      }
    ])
    await sails.models.telemetryspan.createEach([
      requestSpan(environment.id, app.id, 'trace-on-1', true, 118, 200),
      requestSpan(environment.id, app.id, 'trace-on-2', true, 132, 200),
      requestSpan(environment.id, app.id, 'trace-off-1', false, 245, 500),
      requestSpan(environment.id, app.id, 'trace-off-2', false, 181, 200)
    ])
    await sails.models.telemetryexception.create({
      exceptionType: 'CheckoutError',
      message: 'Checkout failed',
      handled: true,
      method: 'GET',
      url: '/checkout',
      traceId: 'trace-off-1',
      occurredAt: Date.now(),
      environment: String(environment.id)
    })

    await page.raw.route('**/api/v1/system/check-update', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ updateAvailable: false })
      })
    })
    await login.withPassword('genesisUser', page, {
      password: current.auth.genesisUserPassword
    })
    await page.resize(1440, 900)
    const appPath = `/projects/${project.slug}/environments/${environment.slug}/apps/${app.slug}?flags=1`

    await page.inLightMode()
    await page.goto(appPath)
    await page.wait('@release-flags')
    await expect(page).toSee('new-checkout')
    await expect(page).toSee('25% · 2 targets')

    const flagsEndpoint = `/api/v1/projects/${project.slug}/environments/${environment.slug}/apps/${app.slug}/flags`
    let successfulToggleRequests = 0
    page.raw.on('request', (request) => {
      if (
        request.method() === 'PATCH' &&
        request.url().includes(`${flagsEndpoint}/`)
      ) {
        successfulToggleRequests += 1
      }
    })
    const fasterSearchSwitch = page.raw.locator(
      '[data-test="release-flag-faster-search-switch"]'
    )
    expect(await fasterSearchSwitch.getAttribute('type')).toBe('checkbox')
    expect(await fasterSearchSwitch.getAttribute('role')).toBe('switch')
    expect(await fasterSearchSwitch.isChecked()).toBe(false)
    const fasterSearchSaved = page.raw.waitForResponse(
      (response) =>
        response.url().includes(`${flagsEndpoint}/`) &&
        response.request().method() === 'PATCH'
    )
    await fasterSearchSwitch.focus()
    await page.raw.keyboard.press('Space')
    expect((await fasterSearchSaved).status()).toBe(200)
    expect(await fasterSearchSwitch.isChecked()).toBe(true)
    expect(successfulToggleRequests).toBe(1)
    expect(
      (
        await sails.models.featureflag.findOne({
          key: 'faster-search',
          app: app.id
        })
      ).enabled
    ).toBe(true)

    let failedToggleRequests = 0
    await page.raw.route(`**${flagsEndpoint}/*`, async (route) => {
      if (route.request().method() !== 'PATCH') return route.continue()
      failedToggleRequests += 1
      await route.fulfill({
        status: 422,
        contentType: 'application/json',
        body: JSON.stringify({
          message: 'Release flag rejected for testing.'
        })
      })
    })
    const newCheckoutSwitch = page.raw.locator(
      '[data-test="release-flag-new-checkout-switch"]'
    )
    expect(await newCheckoutSwitch.isChecked()).toBe(true)
    await newCheckoutSwitch.focus()
    await page.raw.keyboard.press('Space')
    await page.wait('text=Release flag rejected for testing.')
    expect(await newCheckoutSwitch.isChecked()).toBe(true)
    expect(failedToggleRequests).toBe(1)
    await page.raw.unroute(`**${flagsEndpoint}/*`)

    await page.screenshot('.tmp/issue-227-release-flags-light.png', {
      fullPage: true
    })

    await page.inDarkMode()
    await page.raw.emulateMedia({ reducedMotion: 'reduce' })
    await page.wait(250)
    expect(
      await newCheckoutSwitch.evaluate(
        (element) => getComputedStyle(element).transitionDuration
      )
    ).toBe('0.1s')
    await page.screenshot('.tmp/issue-227-release-flags-dark.png', {
      fullPage: true
    })

    await page.goto(
      `/projects/${project.slug}/environments/${environment.slug}/lookout?tab=requests`
    )
    await expect(page).toSee('Release flags')
    await expect(page).toSee('50% err')
    await expect(page).toSee('1 exc')
    await page.screenshot('.tmp/issue-227-lookout-flags-dark.png', {
      fullPage: true
    })
    expect(page).toHaveNoJavascriptErrors()
  }
)

function requestSpan(
  environmentId,
  appId,
  traceId,
  value,
  duration,
  statusCode
) {
  return {
    traceId,
    spanId: `${traceId}-span`,
    name: 'GET /checkout',
    kind: 'server',
    method: 'GET',
    url: '/checkout',
    statusCode,
    duration,
    startedAt: Date.now(),
    attributes: {
      'http.route': '/checkout',
      'feature.app_id': String(appId),
      'feature.flags': {
        'new-checkout': { value, reason: 'rollout', version: 1 }
      }
    },
    environment: String(environmentId)
  }
}
