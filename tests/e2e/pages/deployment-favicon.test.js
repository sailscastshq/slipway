const { test } = require('sounding')

test(
  'browser tab favicon tracks active, terminal, aggregate, and logout states',
  {
    browser: true,
    world: deploymentFaviconWorld('deployment-favicon-success')
  },
  async ({ sails, world, login, page, expect }) => {
    const current = world.current
    const firstDeployment = await createDeployment(world, current, 'building')
    const secondDeployment = await createDeployment(world, current, 'deploying')

    await login.withPassword('genesisUser', page, {
      password: current.auth.genesisUserPassword
    })
    await page.goto('/')

    expect(await waitForFavicon(page, 'deploying')).toBe(
      '/images/favicon-deploying.svg'
    )
    expect(await faviconAssetsAreAvailable(page)).toBe(true)
    await page.screenshot('.tmp/issue-214-deploying-light.png', {
      fullPage: true
    })

    await acknowledgeFavicon(page)
    expect(await faviconState(page)).toBe('deploying')

    await sails.models.deployment.updateOne({ id: firstDeployment.id }).set({
      status: 'running',
      finishedAt: Date.now()
    })

    await page.raw
      .locator('.pointer-events-none.fixed.bottom-4.right-4')
      .getByText('Succeeded', { exact: true })
      .first()
      .waitFor({ state: 'visible' })
    expect(await faviconState(page)).toBe('deploying')

    await sails.models.deployment.updateOne({ id: secondDeployment.id }).set({
      status: 'running',
      finishedAt: Date.now()
    })

    expect(await waitForFavicon(page, 'success')).toBe(
      '/images/favicon-success.svg'
    )
    await acknowledgeFavicon(page)
    expect(await waitForFavicon(page, 'idle')).toBe('/images/favicon.svg')

    const failedDeployment = await createDeployment(world, current, 'building')
    const activeDeployment = await createDeployment(world, current, 'deploying')

    await waitForFavicon(page, 'deploying')

    await sails.models.deployment.updateOne({ id: failedDeployment.id }).set({
      status: 'failed',
      finishedAt: Date.now(),
      errorMessage: 'Build failed for favicon priority proof'
    })
    await page.raw
      .locator('.pointer-events-none.fixed.bottom-4.right-4')
      .getByText('Failed', { exact: true })
      .waitFor({ state: 'visible' })

    expect(await faviconState(page)).toBe('deploying')

    await sails.models.deployment.updateOne({ id: activeDeployment.id }).set({
      status: 'running',
      finishedAt: Date.now()
    })

    expect(await waitForFavicon(page, 'failed')).toBe(
      '/images/favicon-failed.svg'
    )
    await page.inDarkMode()
    await page.screenshot('.tmp/issue-214-failed-dark.png', {
      fullPage: true
    })

    await acknowledgeFavicon(page)
    expect(await waitForFavicon(page, 'idle')).toBe('/images/favicon.svg')

    await page.raw.locator('[data-test="desktop-user-menu-button"]').click()
    await page.raw.getByRole('menuitem', { name: 'Sign out' }).click()

    expect(await waitForFavicon(page, 'idle')).toBe('/images/favicon.svg')
    expect(page).toHaveNoJavascriptErrors()
  }
)

function deploymentFaviconWorld(slug) {
  return {
    name: 'configured-slipway',
    context: {
      deploymentTarget: {
        slug,
        name: 'Deployment Favicon'
      }
    }
  }
}

async function createDeployment(world, current, status) {
  return world.create('deployment').with({
    status,
    triggerType: 'manual',
    environment: current.environments.production.id,
    app: current.apps.web.id,
    triggeredBy: current.users.genesisUser.id,
    startedAt: Date.now() - 5000
  })
}

async function waitForFavicon(page, state) {
  const favicon = page.raw.locator(
    `link[rel~="icon"][data-deployment-state="${state}"]`
  )
  await favicon.waitFor({ state: 'attached' })
  return favicon.getAttribute('href')
}

async function faviconState(page) {
  return page.raw
    .locator('link[rel~="icon"]')
    .getAttribute('data-deployment-state')
}

async function acknowledgeFavicon(page) {
  await page.raw.evaluate(() => window.dispatchEvent(new Event('focus')))
}

async function faviconAssetsAreAvailable(page) {
  return page.script(async () => {
    const responses = await Promise.all(
      ['deploying', 'success', 'failed', 'cancelled'].map((state) =>
        fetch(`/images/favicon-${state}.svg`)
      )
    )

    return responses.every((response) => response.ok)
  })
}
