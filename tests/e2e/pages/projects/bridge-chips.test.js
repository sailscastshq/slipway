const { test } = require('sounding')
const fs = require('node:fs')
const path = require('node:path')

test(
  'Bridge Chips add currency amounts, prevent submission on Enter, remove with keyboard, and fit mobile',
  {
    browser: true,
    world: {
      name: 'configured-slipway',
      context: { deploymentTarget: { slug: 'chips-controls' } }
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
            usd: { type: 'json' },
            ngn: { type: 'json' }
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
            create: ['title', 'usd', 'ngn'],
            list: ['title'],
            fields: {
              usd: {
                type: 'chips',
                label: 'Suggested donations (USD)',
                items: {
                  type: 'currency',
                  currency: {
                    code: 'USD',
                    locale: 'en-US',
                    storage: 'minor',
                    submit: 'minor'
                  }
                }
              },
              ngn: {
                type: 'chips',
                label: 'Suggested donations (NGN)',
                items: {
                  type: 'currency',
                  currency: {
                    code: 'NGN',
                    locale: 'en-NG',
                    storage: 'minor',
                    submit: 'minor'
                  }
                }
              }
            }
          }
        }
      }
    })
    await sails.models.app
      .updateOne({ id: world.current.apps.web.id })
      .set({ status: 'running', containerName: 'chips-controls' })
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
        '/projects/chips-controls/environments/production/bridge/event/new'
      )
      const usd = page.raw.locator('input#bridge-event-usd')
      const ngn = page.raw.locator('input#bridge-event-ngn')
      await expect(usd).toBeVisible()
      for (const amount of ['5', '12.50', '25']) {
        await usd.fill(amount)
        await usd.press('Enter')
      }
      await ngn.fill('1000')
      await ngn.press('Enter')
      await ngn.fill('2500')
      await ngn.press('Enter')
      await expect(
        page.raw.getByRole('button', { name: 'Remove $5', exact: true })
      ).toBeVisible()
      await expect(
        page.raw.getByRole('button', { name: 'Remove ₦1,000', exact: true })
      ).toBeVisible()
      await usd.fill('1.001')
      await usd.press('Enter')
      await expect(
        page.raw.getByRole('alert').filter({ hasText: 'decimal places' })
      ).toBeVisible()
      await usd.fill('')
      const remove = page.raw.getByRole('button', {
        name: 'Remove $25',
        exact: true
      })
      await remove.focus()
      await page.raw.keyboard.press('Space')
      await expect(remove).not.toBeVisible()
      await expect(usd).toBeFocused()
      const out = path.resolve('output/issue-557')
      fs.mkdirSync(out, { recursive: true })
      for (const [width, color] of [
        [1280, 'light'],
        [390, 'dark']
      ]) {
        await page.raw.setViewportSize({ width, height: 900 })
        await page.raw.emulateMedia({ colorScheme: color })
        await usd.blur()
        await page.raw.evaluate(() => window.scrollTo(0, 0))
        await page.screenshot(path.join(out, `bridge-chips-${width}.png`), {
          animations: 'disabled'
        })
        expect(
          await page.raw.evaluate(
            () => document.documentElement.scrollWidth <= innerWidth
          )
        ).toBe(true)
      }
      expect(page).toHaveNoJavascriptErrors()
    } finally {
      Object.assign(sails.helpers.bridge, original)
    }
  }
)
