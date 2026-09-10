const { test } = require('sounding')
const fs = require('node:fs')
const path = require('node:path')

test(
  'Bridge SchedulePicker combines date and time with historical records and mobile overlays',
  {
    browser: true,
    world: {
      name: 'configured-slipway',
      context: { deploymentTarget: { slug: 'date-controls' } }
    }
  },
  async ({ sails, world, login, page, expect }) => {
    const original = { ...sails.helpers.bridge }
    const storedInstant = '2020-02-29T14:35:27.123Z'
    let savedValues
    let persistedRecord = {
      id: 42,
      title: 'Historical event',
      startsAt: storedInstant,
      day: '2020-02-29'
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
      await page.goto(
        '/projects/date-controls/environments/production/bridge/event/new'
      )
      const date = page.raw.locator('input#bridge-event-startsAt')
      await expect(date).toBeVisible()
      expect(await date.getAttribute('type')).toBe('text')
      await date.fill('February 29, 2020 at 14:35')
      await date.press('Enter')
      expect(await date.evaluate((node) => node.checkValidity())).toBe(true)
      const out = path.resolve('output/issue-562')
      fs.mkdirSync(out, { recursive: true })
      for (const [width, color] of [
        [1280, 'light'],
        [390, 'dark']
      ]) {
        await page.raw.setViewportSize({ width, height: 900 })
        await page.raw.emulateMedia({ colorScheme: color })
        await date.focus()
        await date.press('ArrowDown')
        const picker = page.raw.locator(
          '[data-slot="schedule-picker-popover"]:visible'
        )
        await expect(page.raw.getByRole('grid')).toBeVisible()
        await expect(picker.getByLabel('Hour', { exact: true })).toBeVisible()
        await expect(picker.getByLabel('Minute', { exact: true })).toHaveValue(
          '35'
        )
        const box = await picker.boundingBox()
        expect(box.x >= 0 && box.x + box.width <= width).toBe(true)
        await page.screenshot(
          path.join(out, `bridge-schedule-open-${width}.png`),
          { animations: 'disabled' }
        )
        await date.press('Escape')
        await expect(date).toBeFocused()
        await date.blur()
        await page.screenshot(
          path.join(out, `bridge-schedule-closed-${width}.png`),
          { animations: 'disabled' }
        )
      }
      expect(
        await page.raw.locator('#bridge-event-startsAt-time').count()
      ).toBe(0)
      await date.fill('not a valid date')
      await date.press('Enter')
      expect(await date.evaluate((node) => node.checkValidity())).toBe(false)
      await date.fill('January 15, 2030 at 09:15')
      await date.press('Enter')
      expect(await date.evaluate((node) => node.checkValidity())).toBe(true)
      await date.fill('')
      await expect(date).toHaveValue('')
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
      await from.fill('February 29, 2020 at 14:35')
      await from.press('Enter')
      await from.focus()
      await page.raw.keyboard.press('ArrowDown')
      await expect(page.raw.getByRole('grid')).toBeVisible()
      await page.screenshot(path.join(out, 'bridge-filter-schedule-390.png'), {
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
      const cdp = await page.raw.context().newCDPSession(page.raw)
      try {
        for (const timezoneId of ['Africa/Lagos', 'America/New_York']) {
          await cdp.send('Emulation.setTimezoneOverride', { timezoneId })
          await page.goto(
            '/projects/date-controls/environments/production/bridge/event/42/edit'
          )
          const expected = await page.raw.evaluate(
            (iso) =>
              new Intl.DateTimeFormat(navigator.language, {
                dateStyle: 'medium',
                timeStyle: 'medium'
              }).format(new Date(iso)),
            storedInstant
          )
          await expect(date).toHaveValue(expected)
          await date.focus()
          await date.press('ArrowDown')
          await date.press('Escape')
          await page.raw
            .locator('#bridge-event-title')
            .fill(`Historical event ${timezoneId}`)
          await page.raw
            .getByRole('button', { name: 'Save changes', exact: true })
            .click()
          await page.raw.waitForURL((url) => url.pathname.endsWith('/event/42'))
          expect(savedValues.startsAt).toBe(storedInstant)
        }
      } finally {
        await cdp.detach()
      }
      expect(page).toHaveNoJavascriptErrors()
    } finally {
      Object.assign(sails.helpers.bridge, original)
    }
  }
)
