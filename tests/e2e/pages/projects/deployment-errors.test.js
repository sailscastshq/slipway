const { test } = require('sounding')

test(
  'failed deployment explains an early error even when no logs exist',
  { browser: true },
  async ({ sails, login, page, expect }) => {
    const current = await sails.sounding.world.use('configured-slipway')
    const project = await sails.models.project
      .create({
        name: 'Visible Failures',
        slug: 'visible-failures',
        team: current.teams.genesisTeam.id,
        createdBy: current.users.genesisUser.id
      })
      .fetch()
    const environment = await sails.models.environment
      .create({
        name: 'Production',
        slug: 'production',
        project: project.id,
        isProduction: true
      })
      .fetch()
    const deployment = await sails.models.deployment
      .create({
        status: 'failed',
        environment: environment.id,
        errorMessage:
          'No deployable source is available. Push source or connect a repository.',
        startedAt: Date.now(),
        finishedAt: Date.now()
      })
      .fetch()

    await login.withPassword(current.users.genesisUser, page, {
      password: current.auth.genesisUserPassword
    })
    await page.goto(`/projects/visible-failures/deployments/${deployment.id}`)

    const alert = page.getByRole('alert')
    expect(await alert.isVisible()).toBe(true)
    expect(await alert.getByText('Deployment failed').isVisible()).toBe(true)
    expect(
      await alert.getByText(/No deployable source is available/).isVisible()
    ).toBe(true)
    expect(
      await page.getByText('No additional logs were captured.').isVisible()
    ).toBe(true)
  }
)
