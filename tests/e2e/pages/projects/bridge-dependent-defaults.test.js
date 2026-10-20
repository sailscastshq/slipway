const fs = require('node:fs')
const path = require('node:path')
const { test } = require('sounding')
const { setup } = require('../../../support/bridge-dependent-defaults')

test(
  'Native Bridge fills proposal defaults and keeps custom break edits',
  {
    browser: true,
    world: {
      name: 'configured-slipway',
      context: { deploymentTarget: { slug: 'defaults-ui' } }
    }
  },
  async ({ sails, world, login, page, expect }) => {
    const state = await setup(sails, world)
    const root = path.resolve(
      '.tmp/sounding/artifacts/bridge-dependent-defaults'
    )
    fs.mkdirSync(root, { recursive: true })
    try {
      await login.withPassword('genesisUser', page, {
        password: world.current.auth.genesisUserPassword
      })
      await page.raw.waitForURL((url) => !url.pathname.startsWith('/login'))
      await page.goto(
        '/projects/defaults-ui/environments/production/bridge/session/new'
      )
      const choose = async (label, option) => {
        await page.raw
          .getByRole('combobox', { name: new RegExp(`^${label}\\b`) })
          .click()
        await page.raw
          .getByRole('option', { name: option, exact: true })
          .click()
      }
      await choose('Event', 'SailsConf')
      await choose('Proposal', 'Building with Sails')
      const title = page.raw.getByRole('textbox', {
        name: /^Title\b/
      })
      await expect(title).toHaveValue('Building with Sails')
      await expect(
        page.raw.getByRole('textbox', { name: /^Speaker\b/ })
      ).toHaveValue('Ada Example')
      await choose('Proposal', 'Shipping safely')
      await expect(title).toHaveValue('Shipping safely')
      for (const width of [1440, 390]) {
        await page.raw.setViewportSize({ width, height: 1000 })
        for (const scheme of ['light', 'dark']) {
          await page.raw.emulateMedia({
            colorScheme: scheme,
            reducedMotion: 'reduce'
          })
          if (scheme === 'dark')
            await expect(
              page.raw.getByRole('combobox', { name: /^Event\b/ })
            ).toHaveCSS('color', 'rgb(255, 255, 255)')
          await page.screenshot(
            path.join(root, `proposal-defaults-${width}-${scheme}.png`),
            { fullPage: true }
          )
        }
      }
      await title.fill('Sponsor introduction')
      await choose('Proposal', 'Building with Sails')
      await expect(title).toHaveValue('Sponsor introduction')
      await choose('Proposal', 'Select…')
      await expect(title).toHaveValue('Sponsor introduction')
      await expect(
        page.raw.getByRole('textbox', { name: /^Speaker\b/ })
      ).toHaveValue('')
      await choose('Event', 'Other event')
      await choose('Proposal', 'Shipping safely')
      await expect(page.raw.getByRole('status')).toContainText(
        'enter them manually'
      )
      await expect(title).toHaveValue('Sponsor introduction')
    } finally {
      state.restore()
    }
  }
)
