const { test } = require('sounding')

test(
  'a Docker-recovered app returns to Running in the existing app UI',
  {
    browser: true,
    world: {
      name: 'configured-slipway',
      context: {
        deploymentTarget: {
          slug: 'status-reconciliation',
          name: 'Status Reconciliation'
        }
      }
    }
  },
  async ({ sails, world, login, page, expect }) => {
    const current = world.current
    const containerName = `slipway-${current.key}-web`
    const originalGetContainerStatus = sails.helpers.docker.getContainerStatus

    sails.helpers.docker.getContainerStatus = async () => ({
      running: true,
      health: 'healthy'
    })

    try {
      const app = await sails.models.app
        .updateOne({ id: current.apps.web.id })
        .set({ status: 'stopped', containerName })

      await login.withPassword('genesisUser', page, {
        password: current.auth.genesisUserPassword
      })
      await page.goto(
        `/projects/${current.projects.deploymentTarget.slug}/environments/${current.environments.production.slug}/apps/${current.apps.web.slug}`
      )

      await page.wait('@deployment-source-warning')
      const warningWidths = await page.script(() => {
        const warning = document.querySelector(
          '[data-test="deployment-source-warning"]'
        )
        return {
          warning: Math.round(warning.getBoundingClientRect().width),
          content: Math.round(
            warning.parentElement.getBoundingClientRect().width
          )
        }
      })

      expect(warningWidths.warning).toBe(warningWidths.content)
      await expect(page).toSee('Stopped')
      await page.screenshot('.tmp/status-recovery-before.png', {
        fullPage: true
      })

      await sails.helpers.lookout.reconcileContainerStatuses.with({
        containerStates: [
          { name: containerName, state: 'running', running: true }
        ]
      })

      expect((await sails.models.app.findOne({ id: app.id })).status).toBe(
        'running'
      )

      await page.reload()
      await expect(page).toSee('Running')
      await page.screenshot('.tmp/status-recovery-running.png', {
        fullPage: true
      })
      expect(page).toHaveNoJavascriptErrors()
    } finally {
      sails.helpers.docker.getContainerStatus = originalGetContainerStatus
    }
  }
)
