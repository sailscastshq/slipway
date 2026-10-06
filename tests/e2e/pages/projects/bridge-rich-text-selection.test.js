const { test } = require('sounding')
const fs = require('node:fs')
const path = require('node:path')

for (const browser of ['desktop', 'mobile']) {
  test(
    `Bridge formats pending native keyboard selection on ${browser}`,
    {
      browser,
      world: {
        name: 'configured-slipway',
        context: {
          deploymentTarget: { slug: `rich-text-selection-${browser}` }
        }
      }
    },
    async ({ sails, world, login, page, expect }) => {
      const original = { ...sails.helpers.bridge }
      const contract =
        await sails.helpers.bridge.normalizeResourceContract.with({
          models: {
            course: {
              identity: 'course',
              tableName: 'courses',
              primaryKey: 'id',
              attributes: {
                id: { type: 'number', autoIncrement: true },
                description: { type: 'string' }
              }
            }
          },
          config: {
            schemaVersion: 1,
            resources: {
              course: {
                edit: ['description'],
                fields: {
                  description: { type: 'richtext', format: 'markdown' }
                }
              }
            }
          }
        })
      await sails.models.app.updateOne({ id: world.current.apps.web.id }).set({
        status: 'running',
        containerName: `rich-text-selection-${browser}`
      })
      sails.helpers.bridge.introspectModels = async () => ({
        ...contract,
        models: contract.resources
      })
      sails.helpers.bridge.buildSailsWrapper = async (code) => code
      sails.helpers.bridge.executeInContainer = async (_container, code) => {
        let output = {}
        if (code.includes('const decisions = Object.create(null);')) {
          const requests = JSON.parse(code.match(/const requests = (.*);/)[1])
          for (const request of requests) {
            output[request.key] ||= {}
            output[request.key][request.action] = true
          }
        }
        if (code.includes('const record = await model.findOne(criteria)')) {
          output = { record: { id: 42, description: '' } }
        }
        return {
          success: true,
          output: JSON.stringify(output),
          error: null,
          exitCode: 0
        }
      }
      try {
        await login.withPassword('genesisUser', page, {
          password: world.current.auth.genesisUserPassword
        })
        await page.raw.waitForURL((url) => !url.pathname.startsWith('/login'))
        await page.goto(
          `/projects/rich-text-selection-${browser}/environments/production/bridge/course/42/edit`
        )
        const editor = page.raw.locator('[data-slot="rich-text-content"]')
        await expect(editor).toBeVisible()
        await editor.click()
        const text = 'Boring releases are good.'
        await page.raw.keyboard.type(text)
        // Invoke the actual toolbar handler at native keyup, before the browser
        // delivers selectionchange. No sleeps or forged editor-state selection.
        await editor.evaluate((element) => {
          document.addEventListener(
            'keyup',
            function format(event) {
              if (event.key !== 'Home') return
              document.removeEventListener('keyup', format, true)
              window.pendingRichTextSelection = {
                dom: window.getSelection().toString(),
                empty: element.editor.state.selection.empty
              }
              document.querySelector('[aria-label="Bold"]').click()
            },
            true
          )
        })
        await page.raw.keyboard.press('Shift+Home')
        expect(
          await page.raw.evaluate(() => window.pendingRichTextSelection)
        ).toEqual({ dom: text, empty: true })
        await expect(editor.locator('p strong')).toHaveText(text)
        await page.raw
          .getByRole('button', { name: 'Edit Description as Markdown' })
          .click()
        const source = page.raw.locator('[data-slot="rich-text-source"]')
        await expect(source).toHaveValue(`**${text}**`)
        await page.raw
          .getByRole('button', { name: 'Edit Description as Visual' })
          .click()
        await expect(editor.locator('p strong')).toHaveText(text)
        await editor.evaluate((element) => {
          element.editor.commands.setTextSelection(
            element.editor.state.doc.content.size - 1
          )
          element.editor.view.focus()
        })
        await page.raw.keyboard.press('Enter')
        await expect(editor.locator('p strong')).toHaveText(text)
        const selection = await editor.evaluate((element) =>
          element.editor.state.selection.toJSON()
        )
        await page.raw.keyboard.press('Alt+F10')
        const headingTool = page.raw.getByRole('button', {
          name: 'Heading',
          exact: true
        })
        await expect(headingTool).toBeFocused()
        expect(
          await headingTool.evaluate((element) => {
            const style = getComputedStyle(element)
            return (
              element.matches(':focus-visible') &&
              style.outlineStyle !== 'none' &&
              parseFloat(style.outlineWidth) > 0
            )
          })
        ).toBe(true)
        await page.raw.keyboard.press('ArrowRight')
        await expect(
          page.raw.getByRole('button', { name: 'Bold', exact: true })
        ).toBeFocused()
        await page.raw.keyboard.press('Escape')
        await expect(editor).toBeFocused()
        expect(
          await editor.evaluate((element) =>
            element.editor.state.selection.toJSON()
          )
        ).toEqual(selection)
        const out = path.resolve('.tmp/screenshots/issue-682')
        fs.mkdirSync(out, { recursive: true })
        for (const colorScheme of ['light', 'dark']) {
          await page.raw.emulateMedia({ colorScheme })
          await expect(editor).toBeFocused()
          expect(
            await editor.evaluate((element) => {
              const surface = getComputedStyle(element)
              const wrapper = getComputedStyle(
                element.closest('[data-slot="rich-text"]')
              )
              return (
                surface.outlineStyle === 'none' &&
                wrapper.outlineStyle === 'none'
              )
            })
          ).toBe(true)
          await page.screenshot(path.join(out, `${browser}-${colorScheme}.png`))
        }
        expect(page).toHaveNoJavascriptErrors()
      } finally {
        Object.assign(sails.helpers.bridge, original)
      }
    }
  )
}
