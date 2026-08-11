const { test } = require('sounding')

test(
  'app actions expose one internal Bridge entry',
  {
    browser: true,
    world: {
      name: 'configured-slipway',
      context: {
        deploymentTarget: {
          slug: 'bridge-app-menu',
          name: 'Bridge App Menu'
        }
      }
    }
  },
  async ({ sails, world, login, page, expect }) => {
    const current = world.current
    const app = current.apps.web
    const environment = current.environments.production
    const project = current.projects.deploymentTarget
    const originalGetContainerStatus = sails.helpers.docker.getContainerStatus

    try {
      await sails.models.app.updateOne({ id: app.id }).set({
        bridgeEnabled: true,
        status: 'running',
        containerName: 'bridge-app-menu-web'
      })
      sails.helpers.docker.getContainerStatus = async () => ({
        running: true,
        health: 'healthy'
      })

      await login.withPassword('genesisUser', page, {
        password: current.auth.genesisUserPassword
      })
      const appPath = `/projects/${project.slug}/environments/${environment.slug}/apps/${app.slug}`
      await page.goto(appPath)
      await page.click('@app-more-menu')

      const bridgeLink = page.raw.getByRole('link', {
        name: 'Bridge',
        exact: true
      })
      await bridgeLink.waitFor({ state: 'visible' })
      expect(await bridgeLink.getAttribute('href')).toBe(`${appPath}/bridge`)
      await expect(page).not.toSee('Bridge in Slipway')
      await expect(page).not.toSee('Public Bridge')
      expect(page).toHaveNoJavascriptErrors()
    } finally {
      sails.helpers.docker.getContainerStatus = originalGetContainerStatus
    }
  }
)
