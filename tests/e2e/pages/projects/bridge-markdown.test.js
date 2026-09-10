const { test } = require('sounding')
const fs = require('node:fs')
const path = require('node:path')

test(
  'Bridge Markdown edits without rewrites and renders safe formatted details',
  {
    browser: true,
    world: {
      name: 'configured-slipway',
      context: { deploymentTarget: { slug: 'markdown-controls' } }
    }
  },
  async ({ sails, world, login, page, expect }) => {
    const original = { ...sails.helpers.bridge }
    const markdown =
      '# A practical Sails workshop\n\nLearn **production patterns** with hands-on examples.\n\n## Outline\n\n1. Build a Waterline model\n2. Deploy with Slipway\n3. Review the release\n\n```js\nawait app.deploy()\n```\n\nRead [the guide](https://sailsjs.com).\n'
    let savedValues
    let persistedRecord = {
      id: 42,
      title: 'Shipping with confidence',
      body: markdown
    }
    const contract = await sails.helpers.bridge.normalizeResourceContract.with({
      models: {
        event: {
          identity: 'event',
          tableName: 'events',
          primaryKey: 'id',
          attributes: {
            id: { type: 'number', autoIncrement: true },
            title: { type: 'string' },
            body: { type: 'string' }
          }
        }
      },
      config: {
        schemaVersion: 1,
        resources: {
          event: {
            label: 'Proposals',
            singularLabel: 'Proposal',
            title: 'title',
            create: ['title', 'body'],
            edit: ['title', 'body'],
            show: ['title', 'body'],
            list: ['title', 'body'],
            fields: {
              body: {
                type: 'richtext',
                format: 'markdown',
                label: 'Proposal outline'
              }
            }
          }
        }
      }
    })
    await sails.models.app
      .updateOne({ id: world.current.apps.web.id })
      .set({ status: 'running', containerName: 'markdown-controls' })
    sails.helpers.bridge.introspectModels = async () => ({
      ...contract,
      models: contract.resources
    })
    sails.helpers.bridge.buildSailsWrapper = async (code) => code
    sails.helpers.bridge.executeInContainer = async (_container, code) => {
      let output = {}
      if (code.includes('const decisions = Object.create(null);')) {
        const requests = JSON.parse(code.match(/const requests = (.*);/)[1])
        for (const r of requests) {
          output[r.key] ||= {}
          output[r.key][r.action] = true
        }
      }
      if (code.includes('const counts = {};')) output = { event: 0 }
      if (code.includes('const records = await'))
        output = { records: [persistedRecord], total: 1 }
      if (code.includes('const fieldErrors = {};')) output = { fieldErrors: {} }
      if (code.includes('const record = await model.findOne(criteria)'))
        output = { record: persistedRecord }
      if (code.includes('await model.updateOne(criteria).set(values);')) {
        savedValues = JSON.parse(code.match(/const values = (.*);/)[1])
        persistedRecord = { ...persistedRecord, ...savedValues }
        output = { record: persistedRecord }
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
      const base =
        '/projects/markdown-controls/environments/production/bridge/event'
      const out = path.resolve('output/issue-567')
      fs.mkdirSync(out, { recursive: true })
      await page.goto(`${base}/42/edit`)
      const editor = page.raw.locator('[data-slot="rich-text-content"]')
      await expect(editor).toBeVisible()
      await expect(editor.locator('ol li')).toHaveCount(3)
      await page.raw
        .getByRole('button', {
          name: 'Edit Proposal outline as Markdown',
          exact: true
        })
        .click()
      await expect(
        page.raw.locator('[data-slot="rich-text-source"]')
      ).toHaveValue(markdown)
      await page.raw
        .getByRole('button', {
          name: 'Edit Proposal outline as Visual',
          exact: true
        })
        .click()
      await expect(editor).toBeVisible()
      await page.raw.locator('#bridge-event-title').focus()
      for (const [width, color] of [
        [1280, 'light'],
        [390, 'dark']
      ]) {
        await page.raw.setViewportSize({ width, height: 1000 })
        await page.raw.emulateMedia({ colorScheme: color })
        await page.screenshot(
          path.join(out, `bridge-markdown-edit-${width}.png`),
          { animations: 'disabled' }
        )
        expect(
          await page.raw.evaluate(
            () => document.documentElement.scrollWidth <= innerWidth
          )
        ).toBe(true)
      }
      await page.raw.locator('#bridge-event-title').fill('Shipping safely')
      await page.raw
        .getByRole('button', { name: 'Save changes', exact: true })
        .click()
      await page.raw.waitForURL((url) => !url.pathname.endsWith('/edit'))
      expect(savedValues.body).toBe(markdown)
      await page.goto(`${base}/42`)
      await expect(page.raw.locator('.bridge-markdown ol li')).toHaveCount(3)
      await expect(page.raw.locator('.bridge-markdown pre')).toContainText(
        'await app.deploy()'
      )
      for (const [width, color] of [
        [1280, 'light'],
        [390, 'dark']
      ]) {
        await page.raw.setViewportSize({ width, height: 1000 })
        await page.raw.emulateMedia({ colorScheme: color })
        await page.screenshot(
          path.join(out, `bridge-markdown-detail-${width}.png`),
          { animations: 'disabled' }
        )
        expect(
          await page.raw.evaluate(
            () => document.documentElement.scrollWidth <= innerWidth
          )
        ).toBe(true)
      }
      await page.goto(base)
      await expect(
        page.raw.getByText(
          'A practical Sails workshop Learn production patterns with ha…',
          { exact: true }
        )
      ).toBeVisible()
      await expect(page.raw.locator('.bridge-markdown')).toHaveCount(0)
      persistedRecord.body =
        'Safe **text**\n\n<script>window.pwned=true</script>\n\n[bad](javascript:alert(1)) <img src=x onerror="window.pwned=true">'
      await page.goto(`${base}/42`)
      const detail = page.raw.locator('.bridge-markdown')
      await expect(detail.locator('script,img,iframe')).toHaveCount(0)
      await expect(detail.locator('[href^="javascript:"]')).toHaveCount(0)
      expect(await page.raw.evaluate(() => window.pwned)).toBe(undefined)
      persistedRecord.body = 'Legacy plain text\r\nSecond line\r\n'
      await page.goto(`${base}/42/edit`)
      await expect(editor).toBeVisible()
      await page.raw.locator('#bridge-event-title').fill('Legacy unchanged')
      await page.raw
        .getByRole('button', { name: 'Save changes', exact: true })
        .click()
      await page.raw.waitForURL((url) => !url.pathname.endsWith('/edit'))
      expect(savedValues.body).toBe('Legacy plain text\r\nSecond line\r\n')
      expect(page).toHaveNoJavascriptErrors()
    } finally {
      Object.assign(sails.helpers.bridge, original)
    }
  }
)
