const { test } = require('sounding')
const path = require('node:path')

async function seedHistory({ sails, world }) {
  const current = world.current
  const target = {
    environment: current.environments.production.id,
    app: current.apps.web.id
  }
  const now = Date.now()
  const currentRelease = await world.create('deployment').with({
    ...target,
    status: 'running',
    triggerType: 'webhook',
    gitBranch: 'main',
    gitCommit: 'c0ffee123456789',
    gitMessage: 'Ship deployment history',
    startedAt: now - 100000,
    finishedAt: now - 90000,
    createdAt: now - 100000
  })
  const previousRelease = await world.create('deployment').with({
    ...target,
    status: 'running',
    triggerType: 'webhook',
    gitMessage: 'Previous successful release',
    startedAt: now - 80000,
    finishedAt: now - 60000,
    createdAt: now - 80000
  })
  await world.create('deployment').with({
    ...target,
    status: 'failed',
    triggerType: 'cli',
    gitMessage: 'Failed release for filtering',
    startedAt: now - 50000,
    finishedAt: now - 45000,
    createdAt: now - 50000
  })
  const buildingRelease = await world.create('deployment').with({
    ...target,
    status: 'building',
    triggerType: 'manual',
    gitMessage: 'Build in progress',
    startedAt: now - 120000,
    createdAt: now - 120000
  })
  await world.create('deployment').with({
    ...target,
    status: 'pending',
    triggerType: 'manual',
    gitMessage: 'Queued behind active build',
    startedAt: null,
    createdAt: now - 1000
  })

  await sails.models.app.updateOne({ id: current.apps.web.id }).set({
    status: 'running',
    currentDeployment: currentRelease.id,
    lastDeployedAt: currentRelease.finishedAt
  })

  return {
    projectSlug: current.projects.deploymentTarget.slug,
    environmentSlug: current.environments.production.slug,
    appSlug: current.apps.web.slug,
    currentReleaseId: currentRelease.id,
    previousReleaseId: previousRelease.id,
    buildingReleaseId: buildingRelease.id,
    appId: current.apps.web.id
  }
}

function historyWorld(slug) {
  return {
    name: 'configured-slipway',
    context: {
      deploymentTarget: {
        slug,
        name: 'Deployment History UI'
      }
    }
  }
}

test(
  'deployment history prioritizes active and current compact rows on desktop',
  { browser: true, world: historyWorld('deployment-history-desktop') },
  async ({ sails, world, login, page, expect }) => {
    const target = await seedHistory({ sails, world })
    await login.withPassword('genesisUser', page, {
      password: world.current.auth.genesisUserPassword
    })
    await page.goto(
      `/projects/${target.projectSlug}/environments/${target.environmentSlug}/apps/${target.appSlug}`
    )

    await page.wait('@deployment-history')
    await page.wait('@active-deployment-row')
    await page.wait('@failed-deployment-row')
    await expect(page).toSee('Deployments')
    await expect(page).toSee('Live')
    await expect(page).toSee('Building')
    await expect(page).toSee('Queued')
    await expect(page).toSee('Failed')
    await expect(page).toSee('Succeeded')
    await expect(page).toSee('main')
    await expect(page).toSee('c0ffee1')

    const rows = await page.script(() =>
      [...document.querySelectorAll('[data-testid="deployment-row"]')].map(
        (row) => row.textContent
      )
    )
    expect(rows.length).toBe(5)
    expect(rows[0].includes('Building')).toBe(true)
    expect(rows[1].includes('Succeeded')).toBe(true)
    expect(rows[1].includes('Live')).toBe(true)
    expect(rows[2].includes('Queued')).toBe(true)
    expect(rows[3].includes('Failed')).toBe(true)
    expect(rows[4].includes('Succeeded')).toBe(true)
    expect(rows.filter((row) => row.includes('Live')).length).toBe(1)
    expect(rows.some((row) => row.includes('Running'))).toBe(false)

    const deploymentToasts = await page.raw
      .locator('.pointer-events-none.fixed.bottom-4.right-4')
      .textContent()
    expect(
      deploymentToasts.indexOf('Building') < deploymentToasts.indexOf('Queued')
    ).toBe(true)

    await page.raw
      .locator('.pointer-events-none.fixed.bottom-4.right-4')
      .evaluate((element) => element.setAttribute('hidden', ''))
    await page.raw
      .locator('[data-testid="deployment-history-section"]')
      .screenshot({
        path: path.resolve('.tmp/issue-421-deployment-outcomes-light.png')
      })

    await page.raw.emulateMedia({ colorScheme: 'dark' })
    await page.raw
      .locator('[data-testid="deployment-history-section"]')
      .screenshot({
        path: path.resolve('.tmp/issue-421-deployment-outcomes-dark.png')
      })
    await page.raw.emulateMedia({ colorScheme: 'light' })

    // A completed SSE transition must transfer the Live marker without
    // changing the lifecycle outcome or presenting two traffic owners.
    await sails.models.app.updateOne({ id: target.appId }).set({
      currentDeployment: target.buildingReleaseId,
      lastDeployedAt: Date.now()
    })
    await sails.models.deployment
      .updateOne({ id: target.buildingReleaseId })
      .set({ status: 'running', finishedAt: Date.now() })

    await page.raw.waitForFunction(() => {
      const rows = [
        ...document.querySelectorAll('[data-testid="deployment-row"]')
      ].map((row) => row.textContent)
      return (
        rows[0].includes('Succeeded') &&
        rows[0].includes('Live') &&
        !rows[1].includes('Live') &&
        rows.filter((row) => row.includes('Live')).length === 1 &&
        rows.every((row) => !row.includes('Running'))
      )
    })
    expect(page).toHaveNoJavascriptErrors()
  }
)
