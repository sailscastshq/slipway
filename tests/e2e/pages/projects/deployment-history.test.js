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
    startedAt: now - 20000,
    finishedAt: now - 5000,
    createdAt: now - 20000
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
    startedAt: now - 3000,
    createdAt: now - 3000
  })

  await sails.models.app.updateOne({ id: current.apps.web.id }).set({
    status: 'running',
    currentDeployment: currentRelease.id,
    lastDeployedAt: currentRelease.finishedAt
  })

  return current.projects.deploymentTarget.slug
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
  'deployment history is clear and keyboard-filterable on desktop',
  { browser: true, world: historyWorld('deployment-history-desktop') },
  async ({ sails, world, login, page, expect }) => {
    const slug = await seedHistory({ sails, world })
    await login.withPassword('genesisUser', page, {
      password: world.current.auth.genesisUserPassword
    })
    await page.goto(`/projects/${slug}`)

    await page.wait('@current-release')
    await page.wait('@active-deployment')
    await page.wait('@deployment-row')
    await expect(page).toSee('Current production release')
    await expect(page).toSee('Ship deployment history')
    await expect(page).toSee('Build in progress')
    await expect(page).toSee('Succeeded')

    await page.press('@deployment-filter-failed', 'Enter')
    await expect(page).toSee('Failed release for filtering')
    expect(page).toHaveNoJavascriptErrors()
  }
)

test(
  'deployment history prioritizes readable cards on mobile',
  { browser: 'mobile', world: historyWorld('deployment-history-mobile') },
  async ({ sails, world, login, page, expect }) => {
    const slug = await seedHistory({ sails, world })
    await login.withPassword('genesisUser', page, {
      password: world.current.auth.genesisUserPassword
    })
    await page.goto(`/projects/${slug}`)

    await page.wait('@current-release')
    await page.wait('@deployment-card')
    await expect(page).toSee('Deployment history')
    await expect(page).toSee('Ship deployment history')
    await expect(page).toSee('Previous successful release')
    expect(page).toHaveNoJavascriptErrors()
  }
)
