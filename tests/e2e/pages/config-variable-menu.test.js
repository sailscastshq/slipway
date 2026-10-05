const { test } = require('sounding')
const fs = require('node:fs')
const path = require('node:path')
const phase = process.env.CONFIG_MENU_REVIEW_PHASE || 'after'
const root = path.resolve('.tmp/local-review/config-menu', phase)

test(
  'variable options use existing Klean positioning and accessible nested controls',
  { browser: true, world: 'configured-slipway' },
  async ({ login, world, page, expect }) => {
    fs.mkdirSync(root, { recursive: true })
    await page.raw.routeWebSocket(/\/rsbuild-hmr(?:\?|$)/, () => {})
    const mutations = []
    const fixture = {
      values: {
        REVIEW_TOKEN: 'synthetic-placeholder',
        MANAGED_VALUE: 'synthetic-managed'
      },
      metadata: {
        REVIEW_TOKEN: {
          kind: 'secret',
          previewPolicy: 'omit',
          description: ''
        },
        MANAGED_VALUE: {
          kind: 'plain',
          previewPolicy: 'inherit',
          managed: true
        }
      }
    }
    await page.raw.route('**/settings/global-env', async (route) => {
      if (route.request().method() !== 'GET') {
        if (route.request().headers().precognition === 'true')
          return route.fulfill({
            status: 204,
            headers: {
              precognition: 'true',
              'precognition-success': 'true',
              vary: 'Precognition'
            }
          })
        const input = route.request().postDataJSON()
        mutations.push({ method: route.request().method(), input })
        fixture.values = input.envVars
        fixture.metadata = input.envVarMetadata
        return route.fulfill({
          status: 303,
          headers: { location: '/settings/global-env' },
          body: ''
        })
      }
      const response = await route.fetch()
      const source = await response.text()
      const isJson = response
        .headers()
        ['content-type']?.includes('application/json')
      const match = isJson
        ? null
        : source.match(
            /(<script[^>]*type="application\/json"[^>]*data-page="app"[^>]*>)([\s\S]*?)(<\/script>)/
          )
      const payload = JSON.parse(isJson ? source : match[2])
      Object.assign(payload.props, {
        globalEnvVars: fixture.values,
        globalEnvVarMetadata: fixture.metadata
      })
      const json = JSON.stringify(payload)
      await route.fulfill({
        response,
        body: isJson
          ? json
          : source.replace(
              match[0],
              `${match[1]}${json.replace(/</g, '\\u003c')}${match[3]}`
            )
      })
    })
    await page.raw.route('**/api/v1/system/check-update', (route) =>
      route.fulfill({ json: { updateAvailable: false } })
    )
    await login.withPassword('genesisUser', page, {
      password: world.current.auth.genesisUserPassword
    })
    await page.raw.waitForURL('**/')
    for (const width of [1440, 390]) {
      await page.resize(width, 1000)
      for (const scheme of ['light', 'dark']) {
        await (scheme === 'light' ? page.inLightMode() : page.inDarkMode())
        fixture.metadata.REVIEW_TOKEN = {
          kind: 'secret',
          previewPolicy: 'omit',
          description: ''
        }
        await page.goto('/settings/global-env')
        const trigger =
          phase === 'before'
            ? page.raw.locator('[data-test=config-menu-REVIEW_TOKEN] summary')
            : page.raw.getByRole('button', {
                name: 'Configure REVIEW_TOKEN',
                exact: true
              })
        await trigger.focus()
        await page.raw.keyboard.press('Enter')
        const surface =
          phase === 'before'
            ? page.raw.locator('[data-test=config-menu-REVIEW_TOKEN] > div')
            : page.raw.getByRole('dialog', { name: 'Configure REVIEW_TOKEN' })
        await expect(surface).toBeVisible()
        if (phase !== 'before') {
          const kind = surface.getByRole('combobox', { name: 'Value type' })
          await expect(kind).toBeFocused()
          await page.raw.keyboard.press('Space')
          await expect(
            page.raw.getByRole('option', { name: 'Plain config', exact: true })
          ).toBeVisible()
          const secret = page.raw.getByRole('option', {
            name: 'Secret',
            exact: true
          })
          await expect(kind).toHaveAttribute(
            'aria-activedescendant',
            await secret.getAttribute('id')
          )
          await page.raw.keyboard.press('ArrowDown')
          const plain = page.raw.getByRole('option', {
            name: 'Plain config',
            exact: true
          })
          await expect(kind).toHaveAttribute(
            'aria-activedescendant',
            await plain.getAttribute('id')
          )
          await page.raw.keyboard.press('Enter')

          await expect(kind).toContainText('Plain config')
          await expect(surface).toBeVisible()
          await page.raw.keyboard.press('Tab')
          await expect(
            surface.getByRole('combobox', { name: 'Preview environments' })
          ).toBeFocused()
          await page.raw.keyboard.press('Tab')
          const description = surface.getByRole('textbox', {
            name: /Description/
          })
          await expect(description).toBeFocused()
          await description.fill('Local review description')
          await page.raw.keyboard.press('Tab')
          await expect(
            surface.getByRole('button', { name: 'Remove variable' })
          ).toBeFocused()
          await page.raw.keyboard.press('Escape')
          await expect(surface).toBeHidden()
          await expect(trigger).toBeFocused()
          await page.raw.keyboard.press('Space')
          await expect(surface).toBeVisible()
          await expect(description).toHaveValue('Local review description')
          const geometry = await surface.boundingBox()
          expect(geometry.x >= 0 && geometry.x + geometry.width <= width).toBe(
            true
          )
        }
        await page.screenshot(path.join(root, `${width}-${scheme}.png`), {
          animations: 'disabled',
          fullPage: true
        })
        if (phase !== 'before') {
          await page.raw.locator('main').click({ position: { x: 5, y: 5 } })
          await expect(surface).toBeHidden()
          await page.raw
            .getByRole('button', {
              name: 'Configure MANAGED_VALUE',
              exact: true
            })
            .click()
          const managed = page.raw.getByRole('dialog', {
            name: 'Configure MANAGED_VALUE'
          })
          await expect(managed).toContainText('Managed by Slipway')
          expect(
            await managed
              .getByRole('button', { name: 'Remove variable' })
              .count()
          ).toBe(0)
          await page.raw.keyboard.press('Escape')
        }
      }
    }
    if (phase === 'before') expect(mutations).toEqual([])
    else {
      expect(mutations.length > 0).toBe(true)
      expect(
        mutations.every(
          (item) =>
            item.method === 'PATCH' &&
            item.input.envVars.REVIEW_TOKEN === 'synthetic-placeholder' &&
            item.input.envVarMetadata.MANAGED_VALUE.managed === true
        )
      ).toBe(true)
    }
    expect(page).toHaveNoSmoke()
  }
)
