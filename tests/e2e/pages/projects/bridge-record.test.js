const { test } = require('sounding')
const fs = require('node:fs')
const path = require('node:path')
const { setup } = require('../../../support/bridge-conditional-actions')

test(
  'Bridge decision dialogs show current fields, reset between records and reject stale decisions',
  {
    browser: true,
    world: {
      name: 'configured-slipway',
      context: { deploymentTarget: { slug: 'conditional-actions' } }
    }
  },
  async ({ sails, world, login, page, expect }) => {
    const state = await setup(sails, world)
    const base =
      '/projects/conditional-actions/environments/production/bridge/submission'
    const out = path.resolve('output/issue-577')
    fs.mkdirSync(out, { recursive: true })
    try {
      await login.withPassword('genesisUser', page, {
        password: world.current.auth.genesisUserPassword
      })
      await page.raw.waitForURL((url) => !url.pathname.startsWith('/login'))
      const dialog = page.raw.locator(
        '[data-test="bridge-action-dialog-sendDecision"]'
      )
      const submit = dialog.getByRole('button', {
        name: 'Send decision',
        exact: true
      })
      async function open(title) {
        await page.raw
          .getByRole('button', { name: `Actions for ${title}`, exact: true })
          .click()
        await page.raw
          .getByRole('menuitem', { name: 'Send decision', exact: true })
          .click()
        await expect(dialog).toBeVisible()
      }
      await page.goto(`${base}/1`)
      await open('Building with Sails')
      await expect(dialog.locator('textarea')).toHaveCount(1)
      const message = page.raw.locator(
        '#bridge-proposal-sendDecision-acceptanceMessage'
      )
      const reason = page.raw.locator('#bridge-proposal-sendDecision-reason')
      await expect(message).toBeVisible()
      await expect(reason).toHaveCount(0)
      await expect(submit).toBeEnabled()
      await message.fill('We would love to have you speak.')
      await page.raw.setViewportSize({ width: 1280, height: 900 })
      await page.screenshot(path.join(out, 'accepted-desktop.png'), {
        animations: 'disabled'
      })
      await dialog.getByRole('button', { name: 'Cancel', exact: true }).click()
      await open('Building with Sails')
      await expect(message).toHaveValue('')
      await submit.click()
      await expect(dialog).toBeHidden()
      expect(state.calls.length).toBe(1)
      await page.screenshot(path.join(out, 'decision-sent-desktop.png'), {
        animations: 'disabled'
      })
      expect(Object.keys(state.calls[0].values).includes('reason')).toBe(false)

      await page.goto(`${base}/2`)
      await open('Shipping safely')
      await expect(message).toHaveCount(0)
      await expect(reason).toBeVisible()
      await expect(submit).toBeDisabled()
      await reason.fill('The program is full this year.')
      await expect(submit).toBeEnabled()
      await page.raw.setViewportSize({ width: 390, height: 844 })
      await page.raw.emulateMedia({ colorScheme: 'dark' })
      await page.screenshot(path.join(out, 'rejected-mobile.png'), {
        animations: 'disabled'
      })
      expect(
        await page.raw.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth
        )
      ).toBe(true)
      state.records[2].status = 'accepted'
      await submit.click()
      await expect(dialog.getByRole('alert')).toContainText('status changed')
      await expect(reason).toHaveValue('The program is full this year.')
      expect(state.calls.length).toBe(1)
      await page.screenshot(path.join(out, 'stale-decision-mobile.png'), {
        animations: 'disabled'
      })
      await dialog.getByRole('button', { name: 'Cancel', exact: true }).click()
      await open('Shipping safely')
      await expect(reason).toHaveCount(0)
      await expect(message).toHaveValue('')
      await dialog.getByRole('button', { name: 'Cancel', exact: true }).click()
      state.records[2].status = 'draft'
      await page.goto(`${base}/2`)
      await page.raw
        .getByRole('button', {
          name: 'Actions for Shipping safely',
          exact: true
        })
        .click()
      await expect(
        page.raw.getByRole('menuitem', { name: 'Send decision', exact: true })
      ).toHaveCount(0)
      expect(page).toHaveNoJavascriptErrors()
    } finally {
      state.restore()
    }
  }
)

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
