const { test } = require('sounding')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')

test(
  'content edits survive cancelled navigation, reload and back navigation until saved',
  {
    browser: true,
    world: {
      name: 'configured-slipway',
      context: { deploymentTarget: { slug: 'unsaved-content' } }
    }
  },
  async ({ sails, world, login, page, expect }) => {
    const current = world.current
    const root = fs.mkdtempSync(
      path.join(os.tmpdir(), 'slipway-content-draft-')
    )
    const original = sails.config.custom.slipwayAppsDir
    const folder = path.join(root, 'unsaved-content', 'content', 'posts')
    fs.mkdirSync(folder, { recursive: true })
    fs.writeFileSync(path.join(folder, 'draft.json'), '{"title":"Original"}')
    sails.config.custom.slipwayAppsDir = root
    await sails.models.environment
      .updateOne({ id: current.environments.production.id })
      .set({ features: { 'sails-content': { contentDir: 'content' } } })
    let unloads = 0
    page.raw.on('dialog', async (dialog) => {
      unloads++
      await dialog.accept()
    })
    try {
      await login.withPassword('genesisUser', page, {
        password: current.auth.genesisUserPassword
      })
      const url = `/projects/unsaved-content/content/posts/draft?appSlug=${current.apps.web.slug}`
      await page.goto(url)
      const source = page.raw.locator('[data-test="content-json-source"]')
      await source.fill('{"title":"Keep this draft"}')
      await page.raw.locator('[data-slot="breadcrumb"] a').first().click()
      await page.raw.getByRole('button', { name: 'Keep editing' }).waitFor()
      await expect(
        page.raw.getByRole('dialog').getByRole('button')
      ).toHaveCount(2)
      fs.mkdirSync('.github/screenshots/audit-content-unsaved', {
        recursive: true
      })
      await page.screenshot(
        '.github/screenshots/audit-content-unsaved/navigation.png',
        { fullPage: true, animations: 'disabled' }
      )
      await page.raw.getByRole('button', { name: 'Keep editing' }).click()
      expect(await source.inputValue()).toContain('Keep this draft')
      await page.raw.reload()
      await page.raw.getByRole('button', { name: 'Restore draft' }).waitFor()
      await page.screenshot(
        '.github/screenshots/audit-content-unsaved/recovery.png',
        { fullPage: true, animations: 'disabled' }
      )
      await page.raw.getByRole('button', { name: 'Restore draft' }).click()
      expect(await source.inputValue()).toContain('Keep this draft')
      expect(unloads > 0).toBe(true)
      // A real Inertia history visit away and back must offer the draft again.
      await page.raw.goBack()
      await page.raw.goForward()
      await page.raw.getByRole('button', { name: 'Restore draft' }).click()
      expect(await source.inputValue()).toContain('Keep this draft')
      await source.fill('invalid JSON')
      await page.raw.locator('[data-slot="breadcrumb"] a').first().click()
      await page.raw.getByRole('button', { name: 'Keep editing' }).click()
      await source.focus()
      await page.key('ControlOrMeta+s')
      await page.raw.locator('#content-raw-error').waitFor()
      expect(await source.inputValue()).toBe('invalid JSON')
      await source.fill('{"title":"Keep this draft"}')
      await page.raw
        .locator('[data-test="content-save-menu"] button')
        .first()
        .click()
      await expect(
        page.raw.getByRole('button', { name: 'Save', exact: true })
      ).toBeDisabled()
      await page.raw.locator('[data-slot="breadcrumb"] a').first().click()
      await page.raw.waitForURL((url) => url.pathname === '/')
      expect(
        fs.readFileSync(path.join(folder, 'draft.json'), 'utf8')
      ).toContain('Keep this draft')
      await page.goto(url)
      expect(
        await page.raw.getByRole('button', { name: 'Restore draft' }).count()
      ).toBe(0)
      await source.fill('{"title":"Discard this edit"}')
      await page.raw.locator('[data-slot="breadcrumb"] a').first().click()
      await page.raw.getByRole('button', { name: 'Discard and leave' }).click()
      await page.raw.waitForURL((url) => url.pathname === '/')
      expect(
        fs.readFileSync(path.join(folder, 'draft.json'), 'utf8')
      ).toContain('Keep this draft')
      expect(page).toHaveNoJavascriptErrors()
    } finally {
      sails.config.custom.slipwayAppsDir = original
      fs.rmSync(root, { recursive: true, force: true })
    }
  }
)
