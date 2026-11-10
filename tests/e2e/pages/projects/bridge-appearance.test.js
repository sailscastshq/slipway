const { test } = require('sounding')
const fs = require('node:fs')
const path = require('node:path')
const { setup } = require('../../../support/bridge-conditional-actions')
const appearance = require('../../../../api/lib/app-appearance')

test(
  'host-origin Bridge keeps branded partition data legible when app mode differs from the system',
  {
    browser: true,
    world: {
      name: 'configured-slipway',
      context: {
        deploymentTarget: { slug: 'bridge-appearance', name: 'Harbor' }
      }
    }
  },
  async ({ sails, world, page, expect }) => {
    const state = await setup(sails, world)
    state.contract.resources.proposal.actionDefinitions.sendDecision.fields.notify =
      {
        type: 'boolean',
        label: 'Notify team',
        field: { type: 'boolean', default: false }
      }
    sails.helpers.bridge.queryResource = {
      with: async () => ({ records: Object.values(state.records), total: 2 })
    }
    const current = world.current
    const app = current.apps.web
    const project = current.projects.deploymentTarget
    const environment = current.environments.production
    const internal = `/projects/${project.slug}/environments/${environment.slug}/apps/${app.slug}/bridge`
    const root = path.resolve('.tmp/screenshots/bridge-appearance')
    fs.mkdirSync(root, { recursive: true })
    const dashboard = {
      id: 'overview',
      label: 'Workspace overview',
      scope: 'app',
      default: true,
      cards: [
        { id: 'total', type: 'metric', label: 'Submissions', value: 42 },
        {
          id: 'status',
          type: 'partition',
          label: 'Submission status',
          segments: [
            { label: 'Accepted', value: 30 },
            { label: 'Pending', value: 12 }
          ]
        }
      ]
    }
    sails.helpers.bridge.introspectModels = async () => ({
      ...state.contract,
      models: state.contract.resources,
      dashboards: { overview: dashboard }
    })
    sails.helpers.bridge.resolveDashboard = { with: async () => dashboard }
    const hex = (rgb) =>
      '#' +
      rgb
        .match(/\d+/g)
        .slice(0, 3)
        .map((n) => Number(n).toString(16).padStart(2, '0'))
        .join('')

    const ratios = []
    const rgb = (hex) =>
      `rgb(${hex
        .slice(1)
        .match(/../g)
        .map((part) => parseInt(part, 16))
        .join(', ')})`
    try {
      await sails.models.app
        .updateOne({ id: app.id })
        .set({ bridgeEnabled: true, routePath: '/' })
      await sails.helpers.bridge.ensureAppSecret.with({
        appId: String(app.id),
        rotate: true
      })
      const access = await sails.models.bridgeaccess
        .create({
          email: 'editor@host-app.example',
          role: 'editor',
          status: 'active',
          hostUserId: 'appearance-editor',
          hostUserName: 'Appearance Editor',
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
      const guestStyles = await fetch(
        `http://127.0.0.1:${
          sails.hooks.http.server.address().port
        }${internal}/_/appearance.css`,
        {
          headers: {
            accept: 'application/json',
            'x-forwarded-host': 'host-app.example'
          },
          redirect: 'manual'
        }
      )
      expect(guestStyles.status).toBe(401)
      expect(
        sails.config.session.isSessionDisabled({
          path: '/css/app.css',
          _sails: sails
        })
      ).toBe(true)
      await page.raw.setExtraHTTPHeaders({
        'x-forwarded-host': 'host-app.example'
      })
      await page.raw.route('**/bridge**', async (route) => {
        const url = new URL(route.request().url())
        if (url.pathname === '/bridge/launch') {
          const response = await route.fetch({ maxRedirects: 0 })
          const headers = { ...response.headers() }
          if (headers.location === '/bridge') headers.location = internal
          await route.fulfill({ response, headers })
          return
        }
        if (url.pathname.startsWith('/bridge/_assets/'))
          url.pathname = url.pathname.replace('/bridge/_assets', '')
        else if (
          url.pathname === '/bridge' ||
          url.pathname.startsWith('/bridge/')
        )
          url.pathname = internal + url.pathname.slice('/bridge'.length)
        if (route.request().method() !== 'GET') {
          const response = await route.fetch({
            url: url.toString(),
            maxRedirects: 0
          })
          const headers = { ...response.headers() }
          if (headers.location?.startsWith('/bridge/'))
            headers.location =
              internal + headers.location.slice('/bridge'.length)
          await route.fulfill({ response, headers })
          return
        }
        await route.continue({ url: url.toString() })
      })
      await page.raw.route('**/api/bridge-appearance-preview', (route) =>
        route.fulfill({
          status: 403,
          contentType: 'application/json',
          body: '{}'
        })
      )
      await page.goto(
        `/bridge/launch?code=${encodeURIComponent(code)}&hostOrigin=true`
      )
      await page.raw.setViewportSize({ width: 1440, height: 1000 })
      for (const mode of ['light', 'dark']) {
        await sails.helpers.setting.set(
          `app-appearance:v1:${app.id}`,
          JSON.stringify({ ...appearance.normalize({}, 'Harbor'), mode })
        )
        await page.raw.emulateMedia({
          colorScheme: mode === 'light' ? 'dark' : 'light'
        })
        await page.goto('/bridge')
        await expect(
          page.raw.locator('[data-test="bridge-workspace"]')
        ).toBeVisible()
        await expect(
          page.raw.getByRole('heading', { name: dashboard.label })
        ).toBeVisible()
        await expect(
          page.raw.locator('.app-appearance').first()
        ).toHaveAttribute('data-appearance-mode', mode)
        const colors = await page.raw
          .locator('[aria-labelledby="bridge-card-status"] .h-1 > .h-1')
          .first()
          .evaluate((element) => ({
            fill: getComputedStyle(element).backgroundColor,
            track: getComputedStyle(element.parentElement).backgroundColor,
            canvas: getComputedStyle(document.documentElement).getPropertyValue(
              '--app-canvas'
            ),
            text: getComputedStyle(document.documentElement).getPropertyValue(
              '--app-text'
            )
          }))
        const stylesheet = await page.raw.evaluate(async () => {
          const response = await fetch('/bridge/_/appearance.css')
          return {
            status: response.status,
            contentType: response.headers.get('content-type'),
            css: (await response.text()).slice(0, 200),
            sheets: Array.from(
              document.querySelectorAll('link[rel="stylesheet"]')
            ).map((link) => ({
              href: link.getAttribute('href'),
              loaded: Boolean(link.sheet)
            }))
          }
        })
        const measured = {
          mode,
          ...colors,
          stylesheet,
          contrast: appearance.contrast(hex(colors.fill), hex(colors.track))
        }
        ratios.push(measured)
        await page.screenshot(
          path.join(
            root,
            `bridge-${
              process.env.BRIDGE_APPEARANCE_CAPTURE || 'after'
            }-${mode}.png`
          ),
          { fullPage: true, animations: 'disabled' }
        )
        await page.goto('/bridge/submission')
        const row = page.raw
          .locator('tbody tr')
          .filter({ hasText: 'Building with Sails' })
        await expect(row).toBeVisible()
        measured.header = await page.raw
          .locator('thead')
          .evaluate((element) => ({
            background: getComputedStyle(element).backgroundColor,
            text: getComputedStyle(element.querySelector('th:last-child')).color
          }))
        measured.headerContrast = appearance.contrast(
          hex(measured.header.background),
          hex(measured.header.text)
        )
        await row.hover()
        measured.row = await row.evaluate((element) => ({
          background: getComputedStyle(element).backgroundColor,
          text: getComputedStyle(
            element.querySelector('a') || element.querySelector('td')
          ).color
        }))
        measured.rowContrast = appearance.contrast(
          hex(measured.row.background),
          hex(measured.row.text)
        )
        await page.screenshot(
          path.join(
            root,
            `bridge-${
              process.env.BRIDGE_APPEARANCE_CAPTURE || 'after'
            }-table-${mode}.png`
          ),
          { fullPage: true, animations: 'disabled' }
        )
        await page.goto('/bridge/submission/1')
        await page.raw
          .getByRole('button', {
            name: 'Actions for Building with Sails',
            exact: true
          })
          .click()
        const item = page.raw.getByRole('menuitem', {
          name: 'Send decision',
          exact: true
        })
        await item.hover()
        measured.menu = await item.evaluate((element) => ({
          background: getComputedStyle(element).backgroundColor,
          text: getComputedStyle(element).color
        }))
        measured.menuContrast = appearance.contrast(
          hex(measured.menu.background),
          hex(measured.menu.text)
        )
        await item.click()
        const dialog = page.raw.locator(
          '[data-test="bridge-action-dialog-sendDecision"]'
        )
        await expect(dialog).toBeVisible()
        measured.dialogBackground = await dialog.evaluate(
          (element) => getComputedStyle(element).backgroundColor
        )
        const toggle = dialog.getByRole('switch', { name: 'Notify team' })
        await expect(toggle).toBeVisible()
        const textarea = dialog.locator('textarea').first()
        await textarea.focus()
        await textarea.press('Tab')
        await expect(toggle).toBeFocused()
        await expect(toggle).toHaveCSS(
          'outline-color',
          rgb(appearance.palettes[mode].focus)
        )
        measured.focusOutline = await toggle.evaluate(
          (element) => getComputedStyle(element).outlineColor
        )
        await toggle.check()
        await expect(toggle).toBeChecked()
        await expect(toggle).toHaveCSS(
          'background-color',
          rgb(appearance.palettes[mode].accent)
        )
        measured.toggle = await toggle.evaluate((element) => ({
          background: getComputedStyle(element).backgroundColor,
          thumb: getComputedStyle(element, '::after').backgroundColor
        }))
        await page.screenshot(
          path.join(
            root,
            `bridge-${
              process.env.BRIDGE_APPEARANCE_CAPTURE || 'after'
            }-dialog-${mode}.png`
          ),
          { fullPage: true, animations: 'disabled' }
        )
        await dialog
          .getByRole('button', { name: 'Cancel', exact: true })
          .click()
        state.onDecision = async () => ({
          preview: {
            type: 'video',
            title: 'Protected fixture preview',
            url: '/api/bridge-appearance-preview'
          }
        })
        await page.raw
          .getByRole('button', {
            name: 'Actions for Building with Sails',
            exact: true
          })
          .click()
        await page.raw
          .getByRole('menuitem', { name: 'Send decision', exact: true })
          .click()
        await dialog
          .getByRole('button', { name: 'Send decision', exact: true })
          .click()
        const media = page.raw.locator(
          'dialog[aria-labelledby="bridge-media-title"]'
        )
        await expect(media).toBeVisible()
        await expect(media.getByRole('alert')).toBeVisible()
        measured.mediaBackground = await media.evaluate(
          (element) => getComputedStyle(element).backgroundColor
        )
        expect(
          await media.evaluate((element) =>
            Boolean(element.closest('.app-appearance'))
          )
        ).toBe(true)
        await page.screenshot(
          path.join(
            root,
            `bridge-${
              process.env.BRIDGE_APPEARANCE_CAPTURE || 'after'
            }-media-${mode}.png`
          ),
          { fullPage: true, animations: 'disabled' }
        )
        await media.getByRole('button', { name: 'Close preview' }).click()
      }
      fs.writeFileSync(
        path.join(
          root,
          `${process.env.BRIDGE_APPEARANCE_CAPTURE || 'after'}-contrast.json`
        ),
        JSON.stringify(ratios, null, 2)
      )
      for (const value of ratios) {
        expect(value.stylesheet.status).toBe(200)
        expect(value.contrast >= 3).toBe(true)
        expect(value.rowContrast >= 4.5).toBe(true)
        expect(value.headerContrast >= 4.5).toBe(true)
        expect(value.menuContrast >= 4.5).toBe(true)
        expect([
          appearance.palettes[value.mode].canvas,
          appearance.palettes[value.mode].surface
        ]).toContain(hex(value.dialogBackground))
        expect(hex(value.mediaBackground)).toBe(
          appearance.palettes[value.mode].canvas
        )
        expect(hex(value.toggle.background)).toBe(
          appearance.palettes[value.mode].accent
        )
        expect(hex(value.focusOutline)).toBe(
          appearance.palettes[value.mode].focus
        )
      }
      await sails.models.bridgeaccess
        .updateOne({ id: access.id })
        .set({ status: 'revoked' })
      const revokedStyles = await page.raw.evaluate(async () => {
        const response = await fetch('/bridge/_/appearance.css', {
          headers: { accept: 'application/json' }
        })
        return {
          status: response.status,
          contentType: response.headers.get('content-type')
        }
      })
      expect(revokedStyles.status).toBe(401)
      expect(revokedStyles.contentType).toContain('application/json')
      expect(page).toHaveNoJavascriptErrors()
    } finally {
      state.restore()
    }
  }
)
