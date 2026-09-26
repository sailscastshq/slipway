const { test } = require('sounding')
const { setup } = require('../../../support/bridge-conditional-actions')

test(
  'host-origin Bridge shows action confirmation after redirect',
  {
    browser: true,
    world: {
      name: 'configured-slipway',
      context: { deploymentTarget: { slug: 'bridge-host-toast' } }
    }
  },
  async ({ sails, world, page, expect }) => {
    const state = await setup(sails, world)
    const current = world.current
    const app = current.apps.web
    const environment = current.environments.production
    const project = current.projects.deploymentTarget
    const internalPath = `/projects/${project.slug}/environments/${environment.slug}/apps/${app.slug}/bridge`

    try {
      await sails.models.app.updateOne({ id: app.id }).set({
        bridgeEnabled: true,
        routePath: '/'
      })
      await sails.helpers.bridge.ensureAppSecret.with({
        appId: String(app.id),
        rotate: true
      })
      const access = await sails.models.bridgeaccess
        .create({
          email: 'editor@host-app.example',
          role: 'editor',
          status: 'active',
          hostUserId: 'host-editor',
          hostUserName: 'Host Editor',
          activatedAt: Date.now(),
          app: app.id,
          environment: environment.id,
          project: project.id,
          team: current.teams.genesisTeam.id,
          invitedBy: current.users.genesisUser.id
        })
        .fetch()
      const code = await sails.helpers.bridge.issueLaunchCode.with({
        accessId: String(access.id),
        appId: String(app.id)
      })

      await page.raw.setExtraHTTPHeaders({
        'x-forwarded-host': 'host-app.example'
      })
      await page.raw.route('**/bridge**', async (route) => {
        const url = new URL(route.request().url())
        if (url.pathname === '/bridge/launch') {
          const response = await route.fetch({ maxRedirects: 0 })
          const headers = { ...response.headers() }
          if (headers.location === '/bridge') headers.location = internalPath
          await route.fulfill({ response, headers })
          return
        }
        if (url.pathname.startsWith('/bridge/_assets/')) {
          url.pathname = url.pathname.replace('/bridge/_assets', '')
        } else if (
          url.pathname === '/bridge' ||
          url.pathname.startsWith('/bridge/')
        ) {
          url.pathname = `${internalPath}${url.pathname.slice(
            '/bridge'.length
          )}`
        } else {
          await route.continue()
          return
        }
        if (route.request().method() === 'POST') {
          const response = await route.fetch({
            url: url.toString(),
            maxRedirects: 0
          })
          const headers = { ...response.headers() }
          if (headers.location?.startsWith('/bridge')) {
            headers.location = `${internalPath}${headers.location.slice(
              '/bridge'.length
            )}`
          }
          await route.fulfill({ response, headers })
          return
        }
        await route.continue({ url: url.toString() })
      })

      await page.goto(
        `/bridge/launch?code=${encodeURIComponent(code)}&hostOrigin=true`
      )
      await page.goto('/bridge/submission/1')
      await expect(
        page.raw.locator('[data-test="bridge-workspace"]')
      ).toBeVisible()
      await page.raw
        .getByRole('button', {
          name: 'Actions for Building with Sails',
          exact: true
        })
        .click()
      await page.raw
        .getByRole('menuitem', { name: 'Send decision', exact: true })
        .click()
      await page.raw
        .locator('[data-test="bridge-action-dialog-sendDecision"]')
        .getByRole('button', { name: 'Send decision', exact: true })
        .click()

      await expect(
        page.raw
          .locator('[data-slot="toast"]')
          .filter({ hasText: 'Decision sent.' })
      ).toBeVisible()
      expect(state.calls.length).toBe(1)
      expect(page).toHaveNoJavascriptErrors()
    } finally {
      state.restore()
    }
  }
)
