const { test } = require('sounding')

test(
  'project navigation prefetches on intent without fetching every row on mount',
  {
    browser: true,
    world: {
      name: 'configured-slipway',
      context: {
        deploymentTarget: {
          slug: 'prefetch-navigation',
          name: 'Prefetch navigation'
        }
      }
    }
  },
  async ({ world, login, page, expect }) => {
    await page.raw.route('**/api/v1/system/check-update', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ updateAvailable: false })
      })
    })
    await login.withPassword('genesisUser', page, {
      password: world.current.auth.genesisUserPassword
    })
    await page.resize(1440, 900)

    const project = world.current.projects.deploymentTarget
    const path = `/projects/${project.slug}`
    const requests = []
    page.raw.on('request', (request) => {
      if (
        new URL(request.url()).pathname === path &&
        request.method() === 'GET'
      ) {
        requests.push(request.headers()['purpose'] || 'visit')
      }
    })

    await page.goto('/')
    await page.wait(200)
    expect(requests.length).toBe(0)

    const projectLink = page.raw.getByRole('link', {
      name: project.name,
      exact: true
    })
    const prefetched = page.raw.waitForResponse(
      (response) =>
        new URL(response.url()).pathname === path &&
        response.request().headers()['purpose'] === 'prefetch'
    )
    await projectLink.hover()
    await prefetched
    expect(requests).toEqual(['prefetch'])

    await projectLink.click()
    await page.raw.waitForURL(`**${path}`)
    expect(requests).toEqual(['prefetch'])

    await page.goto('/')
    await page.resize(390, 844)
    await page.raw.locator('[data-test="mobile-sidebar-toggle"]').click()
    await page.raw
      .locator('nav:visible')
      .getByRole('link', { name: 'Settings', exact: true })
      .click()
    await page.raw.waitForURL('**/settings')
    expect(page).toHaveNoSmoke()
  }
)
