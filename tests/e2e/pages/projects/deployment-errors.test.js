const { test } = require('sounding')

test(
  'failed deployment explains an early error even when no logs exist',
  {
    browser: true,
    world: {
      name: 'configured-slipway',
      context: {
        deploymentTarget: {
          slug: 'visible-failures',
          name: 'Visible Failures',
          failure:
            'No deployable source is available. Push source or connect a repository.'
        }
      }
    }
  },
  async ({ world, login, page, expect }) => {
    const current = world.current

    await login.withPassword('genesisUser', page, {
      password: current.auth.genesisUserPassword
    })
    await page.goto(
      `/projects/${current.projects.deploymentTarget.slug}/deployments/${current.deployments.failed.id}`
    )

    await expect(page).toSee('Deployment failed')
    await expect(page).toSee('No deployable source is available')
    await expect(page).toSee('No additional logs were captured.')
    expect(page).toHaveNoSmoke()
  }
)
