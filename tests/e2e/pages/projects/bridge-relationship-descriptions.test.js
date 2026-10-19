const { test } = require('sounding')
const fs = require('node:fs')
const path = require('node:path')

test(
  'Bridge same-name speakers stay distinct with optional descriptions',
  {
    browser: true,
    world: {
      name: 'configured-slipway',
      context: { deploymentTarget: { slug: 'relationship-descriptions' } }
    }
  },
  async ({ sails, world, login, page, expect }) => {
    const original = { ...sails.helpers.bridge }
    const contract = await sails.helpers.bridge.normalizeResourceContract.with({
      models: {
        event: {
          identity: 'event',
          primaryKey: 'id',
          attributes: {
            id: { type: 'number', autoIncrement: true },
            title: { type: 'string' },
            speaker: { model: 'speaker' }
          },
          associations: [{ alias: 'speaker', type: 'model', model: 'speaker' }]
        },
        speaker: {
          identity: 'speaker',
          primaryKey: 'id',
          attributes: {
            id: { type: 'number', autoIncrement: true },
            name: { type: 'string' },
            email: { type: 'string' }
          },
          associations: []
        }
      },
      config: {
        resources: {
          event: {
            create: ['title', 'speaker'],
            fields: {
              speaker: {
                relation: { description: ['email'], search: ['name'], limit: 2 }
              }
            }
          },
          speaker: { title: 'name', search: ['name'] }
        }
      }
    })
    const speakers = [
      { id: 11, name: 'Alex Kim', email: 'alex@north.example' },
      { id: 22, name: 'Alex Kim', email: 'alex@south.example' }
    ]
    const lookups = []
    const searches = []
    try {
      await sails.models.app
        .updateOne({ id: world.current.apps.web.id })
        .set({ status: 'running', containerName: 'synthetic-descriptions' })
      sails.helpers.bridge.introspectModels = async () => ({
        ...contract,
        models: contract.resources
      })
      sails.helpers.bridge.buildSailsWrapper = async (code) => code
      sails.helpers.bridge.executeInContainer = async (_container, code) => {
        if (
          code.includes('const options = {};') ||
          code.includes('const textSearch = definition.query')
        ) {
          if (code.includes('const textSearch = definition.query')) {
            searches.push(JSON.parse(code.match(/const definition = (.*);/)[1]))
          }
          const model = {
            find: ({ skip = 0, limit }) => ({
              select: async (fields) => {
                lookups.push({ skip, fields })
                return speakers
                  .slice(skip, skip + limit)
                  .map((row) =>
                    Object.fromEntries(
                      fields.map((field) => [field, row[field]])
                    )
                  )
              }
            })
          }
          const run = new Function('sails', `return (async () => {${code}})();`)
          return {
            success: true,
            output: JSON.stringify(await run({ models: { speaker: model } }))
          }
        }
        return { success: true, output: '{}', error: null, exitCode: 0 }
      }
      await login.withPassword('genesisUser', page, {
        password: world.current.auth.genesisUserPassword
      })
      await page.raw.waitForURL((url) => !url.pathname.startsWith('/login'))
      await page.goto(
        '/projects/relationship-descriptions/environments/production/bridge/event/new'
      )
      const picker = page.raw.getByRole('combobox', { name: 'Speaker' })
      await picker.click()
      const north = page.raw
        .getByRole('option')
        .filter({ hasText: 'alex@north.example' })
      const south = page.raw
        .getByRole('option')
        .filter({ hasText: 'alex@south.example' })
      await expect(north).toBeVisible()
      await expect(south).toBeVisible()
      expect(lookups.some((query) => query.fields.includes('email'))).toBe(true)
      await expect(
        page.raw.getByRole('option', { name: 'Alex Kim alex@north.example' })
      ).toBeVisible()
      expect(await north.count()).toBe(1)
      expect(await south.count()).toBe(1)
      const searchResponse = page.raw.waitForResponse(
        (response) =>
          response.url().includes('/relationships/speaker/options') &&
          new URL(response.url()).searchParams.get('q') === 'Alex'
      )
      await picker.fill('Alex')
      await searchResponse
      expect(searches.find((search) => search.query === 'Alex').search).toEqual(
        ['name']
      )
      await expect(north).toBeVisible()
      await expect(south).toBeVisible()
      const output = path.resolve('output/issue-763')
      fs.mkdirSync(output, { recursive: true })
      for (const width of [1280, 390]) {
        await page.raw.setViewportSize({ width, height: 900 })
        for (const colorScheme of ['light', 'dark']) {
          await page.raw.emulateMedia({ colorScheme })
          await picker.scrollIntoViewIfNeeded()
          await page.screenshot(
            path.join(
              output,
              `relationship-descriptions-${width}-${colorScheme}.png`
            ),
            { animations: 'disabled' }
          )
          expect(
            await page.raw.evaluate(
              () => document.documentElement.scrollWidth <= innerWidth
            )
          ).toBe(true)
        }
      }
      await south.click()
      await expect(picker).toHaveValue('Alex Kim')
      await expect(picker).toBeFocused()
      await picker.click()
      await expect(south).toHaveAttribute('aria-selected', 'true')
      await expect(north).toHaveAttribute('aria-selected', 'false')
      await picker.press('ArrowUp')
      await picker.press('Enter')
      await picker.click()
      await expect(north).toHaveAttribute('aria-selected', 'true')
      await expect(south).toHaveAttribute('aria-selected', 'false')
      expect(page).toHaveNoJavascriptErrors()
    } finally {
      Object.assign(sails.helpers.bridge, original)
    }
  }
)
