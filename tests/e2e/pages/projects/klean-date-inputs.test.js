const { test } = require('sounding')
const fs = require('node:fs')
const path = require('node:path')

test(
  'Bridge Klean calendar supports historical dates, local time, clearing, and mobile overlays',
  {
    browser: true,
    world: {
      name: 'configured-slipway',
      context: { deploymentTarget: { slug: 'date-controls' } }
    }
  },
  async ({ sails, world, login, page, expect }) => {
    const original = { ...sails.helpers.bridge }
    const contract = await sails.helpers.bridge.normalizeResourceContract.with({
      models: {
        event: {
          identity: 'event',
          tableName: 'events',
          primaryKey: 'id',
          attributes: {
            id: { type: 'number', autoIncrement: true },
            title: { type: 'string' },
            startsAt: { type: 'ref', columnType: 'datetime' },
            day: { type: 'string' }
          }
        }
      },
      config: {
        schemaVersion: 1,
        resources: {
          event: {
            label: 'Events',
            singularLabel: 'Event',
            title: 'title',
            create: ['title', 'startsAt', 'day'],
            list: ['title', 'startsAt'],
            filters: ['startsAt', 'day'],
            fields: {
              startsAt: { type: 'datetime', label: 'Starts at' },
              day: { type: 'date', label: 'Event date' }
            }
          }
        }
      }
    })
    await sails.models.app
      .updateOne({ id: world.current.apps.web.id })
      .set({ status: 'running', containerName: 'date-controls' })
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
        output = { records: [], total: 0 }
      if (code.includes('const fieldErrors = {};')) output = { fieldErrors: {} }
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
        '/projects/date-controls/environments/production/bridge/event/new'
      )
      const date = page.raw.locator('input#bridge-event-startsAt')
      await expect(date).toBeVisible()
      expect(await date.getAttribute('type')).toBe('text')
      await date.fill('2020-02-29')
      await page.raw.getByLabel('Starts at time (24-hour)').fill('14:35')
      const out = path.resolve('output/issue-556')
      fs.mkdirSync(out, { recursive: true })
      for (const [width, color] of [
        [1280, 'light'],
        [390, 'dark']
      ]) {
        await page.raw.setViewportSize({ width, height: 900 })
        await page.raw.emulateMedia({ colorScheme: color })
        await date.focus()
        await page.raw.keyboard.press('ArrowDown')
        await expect(page.raw.getByRole('grid')).toBeVisible()
        await page.raw.waitForFunction(() => {
          const grid = document.querySelector('[role="grid"]')
          const box = grid?.getBoundingClientRect()
          return box && box.x >= 0 && box.right <= innerWidth
        })
        const box = await page.raw.getByRole('grid').boundingBox()
        expect(box.x >= 0 && box.x + box.width <= width).toBe(true)
        await page.screenshot(path.join(out, `bridge-calendar-${width}.png`), {
          animations: 'disabled'
        })
        await page.raw.keyboard.press('Escape')
        await expect(date).toBeFocused()
      }
      await expect(date).toHaveValue('2020-02-29')
      await expect(page.raw.getByLabel('Starts at time (24-hour)')).toHaveValue(
        '14:35'
      )
      await date.fill('')
      await expect(page.raw.getByLabel('Starts at time (24-hour)')).toHaveValue(
        ''
      )
      expect(
        await page.raw
          .locator('input[type="date"],input[type="datetime-local"]')
          .count()
      ).toBe(0)
      await page.goto(
        '/projects/date-controls/environments/production/bridge/event'
      )
      await page.raw.locator('[data-test="bridge-filter-toggle"]').click()
      const from = page.raw.locator('#bridge-filter-startsAt-from')
      await from.fill('2020-02-29')
      await from.focus()
      await page.raw.keyboard.press('ArrowDown')
      await expect(page.raw.getByRole('grid')).toBeVisible()
      await page.screenshot(path.join(out, 'bridge-filter-calendar-390.png'), {
        animations: 'disabled'
      })
      await page.raw.keyboard.press('Escape')
      await expect(page.raw.getByRole('grid')).not.toBeVisible()
      await expect(
        page.raw.locator('[data-test="bridge-filter-panel"]')
      ).toBeVisible()
      await page.raw
        .locator('[data-test="bridge-filter-panel"]')
        .getByRole('button', { name: 'Apply', exact: true })
        .click()
      await page.raw.waitForURL((url) => url.searchParams.has('filters'))
      expect(page).toHaveNoJavascriptErrors()
    } finally {
      Object.assign(sails.helpers.bridge, original)
    }
  }
)
