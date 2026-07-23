const { test } = require('sounding')

test(
  'deployment cancellation keeps the existing detail UI and reports the truthful terminal state',
  {
    browser: true,
    world: {
      name: 'configured-slipway',
      context: {
        deploymentTarget: {
          slug: 'deployment-cancellation',
          name: 'Deployment Cancellation'
        }
      }
    }
  },
  async ({ sails, world, login, page, expect }) => {
    const current = world.current
    const deployment = await world.create('deployment').with({
      status: 'building',
      triggerType: 'manual',
      environment: current.environments.production.id,
      app: current.apps.web.id,
      triggeredBy: current.users.genesisUser.id,
      startedAt: Date.now() - 5000,
      buildLogs: 'Building image for deployment cancellation proof...\n'
    })
    await world.create('deploymentjob').with({
      deployment: deployment.id,
      targetKey: `environment:${current.environments.production.id}`,
      appSlug: current.apps.web.slug,
      stage: 'image_build'
    })

    await login.withPassword('genesisUser', page, {
      password: current.auth.genesisUserPassword
    })
    await page.goto(
      `/projects/${current.projects.deploymentTarget.slug}/deployments/${deployment.id}`
    )

    await expect(page).toSee('Building')
    await expect(page).toSee('In progress')
    await expect(page).toSee('Cancel')
    const cancelButtonClasses = await page.raw
      .locator('[data-test="cancel-deployment"]')
      .getAttribute('class')
    expect(cancelButtonClasses).toContain('bg-red-600')
    expect(cancelButtonClasses).toContain('text-white')
    expect(cancelButtonClasses).toContain('hover:bg-red-700')
    await page.screenshot('.tmp/deployment-cancellation-active.png', {
      fullPage: true
    })

    await page.click('@cancel-deployment')
    await page.raw
      .getByText('Cancelled', { exact: true })
      .waitFor({ state: 'visible' })
    await expect(page).toSee('Cancelled')
    await page.raw
      .locator('.pointer-events-none.fixed.bottom-4.right-4')
      .getByText('Cancelled', { exact: true })
      .waitFor({ state: 'visible' })
    const pageText = await page.raw.locator('body').textContent()
    expect(pageText.includes('Deployment failed')).toBe(false)
    await page.screenshot('.tmp/deployment-cancellation-complete.png', {
      fullPage: true
    })

    const [persistedDeployment, persistedJob] = await Promise.all([
      sails.models.deployment.findOne({ id: deployment.id }),
      sails.models.deploymentjob.findOne({ deployment: deployment.id })
    ])
    expect(persistedDeployment.status).toBe('cancelled')
    expect(persistedJob.stage).toBe('cancelled')
    expect(page).toHaveNoJavascriptErrors()
  }
)
