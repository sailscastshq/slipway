const { test } = require('sounding')

test(
  'an unavailable direct endpoint is explained instead of linked',
  {
    browser: true,
    world: {
      name: 'configured-slipway',
      context: {
        deploymentTarget: {
          slug: 'direct-access-diagnostic',
          name: 'Direct Access Diagnostic'
        }
      }
    }
  },
  async ({ sails, world, login, page, expect }) => {
    const current = world.current
    await sails.models.app.updateOne({ id: current.apps.web.id }).set({
      status: 'running',
      hostPort: 1340,
      port: 1337,
      containerName: null
    })

    await login.withPassword('genesisUser', page, {
      password: current.auth.genesisUserPassword
    })
    await page.goto(
      `/projects/${current.projects.deploymentTarget.slug}/environments/${current.environments.production.slug}/apps/${current.apps.web.slug}`
    )

    await page.wait('@direct-access-diagnostic')
    await expect(page).toSee(
      "Slipway could not verify Docker's host port 1340 mapping."
    )
    expect(page).toHaveNoJavascriptErrors()
  }
)
