const { test } = require('sounding')

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
  await world.create('deployment').with({
    ...target,
    status: 'stopped',
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
  await world.create('deployment').with({
    ...target,
    status: 'building',
    triggerType: 'manual',
    gitMessage: 'Build in progress',
    startedAt: now - 120000,
    createdAt: now - 120000
  })

  await sails.models.app.updateOne({ id: current.apps.web.id }).set({
    status: 'running',
    currentDeployment: currentRelease.id,
    lastDeployedAt: currentRelease.finishedAt
  })

  return {
    projectSlug: current.projects.deploymentTarget.slug,
    environmentSlug: current.environments.production.slug,
    appSlug: current.apps.web.slug
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
    await expect(page).toSee('Running')
    await expect(page).toSee('Building')
    await expect(page).toSee('Failed')
    await expect(page).toSee('Stopped')
    await expect(page).toSee('main')
    await expect(page).toSee('c0ffee1')

    const rows = await page.script(() =>
      [...document.querySelectorAll('[data-testid="deployment-row"]')].map(
        (row) => row.textContent
      )
    )
    expect(rows.length).toBe(4)
    expect(rows[0].includes('Building')).toBe(true)
    expect(rows[1].includes('Running')).toBe(true)
    expect(rows[2].includes('Failed')).toBe(true)
    expect(rows[3].includes('Stopped')).toBe(true)

    expect(page).toHaveNoJavascriptErrors()
  }
)

test(
  'deployment history keeps the compact deployment list on mobile',
  { browser: 'mobile', world: historyWorld('deployment-history-mobile') },
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
    await expect(page).toSee('Deployments')
    await expect(page).toSee('Running')
    await expect(page).toSee('Building')
    await expect(page).toSee('Failed')
    await expect(page).toSee('Stopped')
    expect(page).toHaveNoJavascriptErrors()
  }
)
