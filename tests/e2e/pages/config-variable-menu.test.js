const { test } = require('sounding')
const fs = require('node:fs')
const path = require('node:path')
const phase = process.env.CONFIG_MENU_REVIEW_PHASE || 'after'
for (const project of ['desktop', 'mobile']) {
  const root = path.resolve('.tmp/local-review/config-menu', phase, project)

  test(
    `variable options preserve Klean Select alignment and nested controls on ${project}`,
    { browser: { project }, world: 'configured-slipway' },
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
            redaction: 'unclassified',
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
            redaction: 'unclassified',
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
            if (phase !== 'baseline-fields') {
              for (const control of [
                kind,
                surface.getByRole('combobox', { name: 'Preview environments' }),
                surface.getByRole('combobox', { name: 'Response redaction' }),
                surface.getByRole('textbox', { name: /Description/ })
              ]) {
                const borders = await control.evaluate((element) => {
                  const style = getComputedStyle(element)
                  return {
                    bottom: style.borderBottomStyle,
                    width: style.borderBottomWidth,
                    top: style.borderTopWidth,
                    left: style.borderLeftWidth,
                    right: style.borderRightWidth,
                    background: style.backgroundColor,
                    radius: style.borderTopLeftRadius
                  }
                })
                expect(borders).toEqual({
                  bottom: 'dashed',
                  width: '1px',
                  top: '0px',
                  left: '0px',
                  right: '0px',
                  background: 'rgba(0, 0, 0, 0)',
                  radius: '0px'
                })
                await control.focus()
                expect(
                  await control.evaluate(
                    (element) => getComputedStyle(element).borderBottomStyle
                  )
                ).toBe('dashed')
              }
              await kind.focus()
            }

            for (const select of [
              kind,
              surface.getByRole('combobox', { name: 'Preview environments' }),
              surface.getByRole('combobox', { name: 'Response redaction' })
            ]) {
              await expect(select).toHaveAttribute(
                'data-slot',
                'select-trigger'
              )
              expect(await select.locator('svg').count()).toBe(1)
              const layout = await select.evaluate((element) => {
                const value = element
                  .querySelector('[data-slot="select-value"]')
                  .getBoundingClientRect()
                const icon = element
                  .querySelector('[data-slot="select-icon"]')
                  .getBoundingClientRect()
                return {
                  display: getComputedStyle(element).display,
                  centerGap: Math.abs(
                    value.y + value.height / 2 - (icon.y + icon.height / 2)
                  ),
                  caretAfterValue: icon.left >= value.right,
                  caretInsideTrigger:
                    icon.right <= element.getBoundingClientRect().right
                }
              })
              expect(layout.display).toBe('flex')
              expect(layout.centerGap <= 1).toBe(true)
              expect(layout.caretAfterValue).toBe(true)
              expect(layout.caretInsideTrigger).toBe(true)
            }

            await page.raw.keyboard.press('Space')
            await expect(
              page.raw.getByRole('option', {
                name: 'Plain config',
                exact: true
              })
            ).toBeVisible()
            await page.raw.keyboard.press('Escape')
            await expect(kind).toHaveAttribute('aria-expanded', 'false')
            await expect(surface).toBeVisible()
            await expect(kind).toBeFocused()
            await page.raw.keyboard.press('Enter')
            await page.raw.keyboard.press('Home')
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
            const redaction = surface.getByRole('combobox', {
              name: 'Response redaction'
            })
            await expect(redaction).toBeFocused()
            await redaction.click()
            await page.raw
              .getByRole('option', { name: 'Treat as credential', exact: true })
              .click()
            await expect(redaction).toContainText('Treat as credential')
            await redaction.focus()
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
            await page.raw.waitForFunction(
              ({ label, width }) => {
                const element = [
                  ...document.querySelectorAll('[role="dialog"]')
                ].find((item) => item.getAttribute('aria-label') === label)
                if (!element) return false
                const geometry = element.getBoundingClientRect()
                return geometry.x >= 0 && geometry.right <= width
              },
              { label: 'Configure REVIEW_TOKEN', width }
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
        expect(
          mutations.some(
            (item) =>
              item.input.envVarMetadata.REVIEW_TOKEN.redaction === 'credential'
          )
        ).toBe(true)
      }
      expect(page).toHaveNoSmoke()
    }
  )
}
