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

test(
  'custom domain stays primary ahead of generated and direct app URLs',
  {
    browser: true,
    world: {
      name: 'configured-slipway',
      context: {
        deploymentTarget: {
          slug: 'app-url-priority',
          name: 'App URL Priority'
        }
      }
    }
  },
  async ({ sails, world, login, page, expect }) => {
    const current = world.current
    const originalGetContainerStatus = sails.helpers.docker.getContainerStatus
    const originalGetPortBinding = sails.helpers.docker.getPortBinding

    const getContainerStatus = async () => ({
      running: true,
      health: 'healthy'
    })
    const getPortBinding = async () => ({
      valid: true,
      host: '0.0.0.0',
      hostPort: 1340,
      diagnostic: 'Published on 0.0.0.0:1340.'
    })
    getPortBinding.with = getPortBinding
    sails.helpers.docker.getContainerStatus = getContainerStatus
    sails.helpers.docker.getPortBinding = getPortBinding

    try {
      await sails.models.environment
        .updateOne({ id: current.environments.production.id })
        .set({ domain: 'app.example.com' })
      await sails.models.app.updateOne({ id: current.apps.web.id }).set({
        status: 'running',
        hostPort: 1340,
        port: 1337,
        containerName: `slipway-${current.key}-web`
      })

      await login.withPassword('genesisUser', page, {
        password: current.auth.genesisUserPassword
      })
      await page.inLightMode()
      await page.goto(
        `/projects/${current.projects.deploymentTarget.slug}/environments/${current.environments.production.slug}/apps/${current.apps.web.slug}`
      )

      await page.wait('@app-access-urls')
      const primaryUrl = await page.script(() =>
        document
          .querySelector('[data-test="app-access-urls"] a')
          .textContent.trim()
      )
      expect(primaryUrl).toBe('app.example.com')

      await page.click('@app-access-urls-toggle')
      const orderedKinds = await page.script(() =>
        Array.from(
          document.querySelectorAll(
            '[data-test="app-access-urls-menu"] [data-test^="app-access-url-"]'
          )
        ).map((element) =>
          element.getAttribute('data-test').replace('app-access-url-', '')
        )
      )
      expect(orderedKinds).toEqual(['custom', 'generated', 'direct'])
      await page.screenshot('.tmp/issue-211-app-urls-light.png')

      await page.click('@app-access-urls-toggle')
      await page.key('ControlOrMeta+k')
      await page.fill(
        'input[placeholder="Type a command or search..."]',
        'Copy App URL'
      )
      await page.click('Copy App URL')
      await expect(page).toSee('https://app.example.com')
      await page.key('Escape')
      await page.key('Escape')

      await page.inDarkMode()
      await page.reload()
      await page.click('@app-access-urls-toggle')
      await page.screenshot('.tmp/issue-211-app-urls-dark.png')

      expect(page).toHaveNoJavascriptErrors()
    } finally {
      sails.helpers.docker.getContainerStatus = originalGetContainerStatus
      sails.helpers.docker.getPortBinding = originalGetPortBinding
    }
  }
)
