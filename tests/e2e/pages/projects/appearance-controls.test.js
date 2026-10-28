const { test } = require('sounding')
const fs = require('node:fs')
const path = require('node:path')
for (const browser of ['desktop', 'mobile'])
  test(
    `Appearance breadcrumb and dirty save feedback on ${browser}`,
    {
      browser,
      world: {
        name: 'configured-slipway',
        context: {
          deploymentTarget: {
            slug: `appearance-controls-${browser}`,
            name: 'TemboAI'
          }
        }
      }
    },
    async ({ world, page, login, expect }) => {
      const { apps, environments, projects, auth } = world.current
      const base = `/projects/${projects.deploymentTarget.slug}/environments/${environments.production.slug}/apps/${apps.web.slug}`
      await login.withPassword('genesisUser', page, {
        password: auth.genesisUserPassword
      })
      await page.resize(
        browser === 'mobile' ? 390 : 1440,
        browser === 'mobile' ? 844 : 1100
      )
      await page.goto(`${base}/appearance`)
      const save = page.raw.getByRole('button', { name: 'Save', exact: true })
      const name = page.raw.locator('#appearance-name')
      const original = await name.inputValue()
      await expect(save).toBeDisabled()
      await expect(
        page.raw
          .locator('[aria-current="page"]')
          .filter({ hasText: 'appearance' })
      ).toBeVisible()
      await expect(
        page.raw.getByRole('link', {
          name: `${apps.web.name} settings`,
          exact: true
        })
      ).toHaveAttribute('href', `${base}/settings`)
      await name.fill(` ${original} `)
      await expect(save).toBeDisabled()
      await name.fill('A changed app')
      await expect(save).toBeEnabled()
      await name.fill(original)
      await expect(save).toBeDisabled()
      for (const id of ['mode', 'font', 'radius', 'density']) {
        const input = page.raw.locator(`#appearance-${id}`)
        const value = await input.innerText()
        await input.click()
        const options = page.raw.getByRole('option')
        const next = await options.evaluateAll(
          (items, current) =>
            items
              .find((item) => item.textContent.trim() !== current.trim())
              .textContent.trim(),
          value
        )
        await page.raw.getByRole('option', { name: next, exact: true }).click()
        await expect(save).toBeEnabled()
        await input.click()
        await page.raw
          .getByRole('option', { name: value.trim(), exact: true })
          .click()
        await expect(save).toBeDisabled()
      }
      const modeControl = page.raw.locator('#appearance-mode')
      const initialMode = (await modeControl.innerText()).trim()
      await modeControl.click()
      await page.raw
        .getByRole('option', { name: 'Follow app', exact: true })
        .click()
      const fallback = page.raw.locator('#appearance-fallback')
      const initialFallback = (await fallback.innerText()).trim()
      await fallback.click()
      await page.raw.getByRole('option', { name: 'Dark', exact: true }).click()
      await expect(save).toBeEnabled()
      await fallback.click()
      await page.raw
        .getByRole('option', { name: initialFallback, exact: true })
        .click()
      await modeControl.click()
      await page.raw
        .getByRole('option', { name: initialMode, exact: true })
        .click()
      await expect(save).toBeDisabled()
      for (const mode of ['light', 'dark']) {
        await page.raw
          .getByRole('button', { name: new RegExp('^' + mode + '$', 'i') })
          .first()
          .click()
        await expect(save).toBeDisabled()
        const color = page.raw.getByLabel(`${mode} Accent`, { exact: true })
        const before = await color.inputValue()
        await color.fill(mode === 'light' ? '#101010' : '#eeeeee')
        await expect(save).toBeEnabled()
        await color.fill(before)
        await expect(save).toBeDisabled()
      }
      const logoText = page.raw.locator('#appearance-logo-text')
      const originalText = await logoText.inputValue()
      await logoText.fill('Company logo')
      await expect(save).toBeEnabled()
      await logoText.fill(originalText)
      await expect(save).toBeDisabled()
      const file = page.raw.locator('#appearance-logoLight')
      await file.setInputFiles(
        path.resolve('tests/fixtures/appearance/tembo-logo.png')
      )
      await expect(save).toBeEnabled()
      await page.raw
        .getByRole('button', { name: 'Remove', exact: true })
        .click()
      await expect(save).toBeDisabled()
      let attempts = 0,
        release
      let gate = new Promise((resolve) => {
        release = resolve
      })
      await page.raw.route(`**${base}/appearance`, async (route) => {
        if (route.request().method() !== 'PATCH') return route.continue()
        attempts++
        if (attempts === 1) {
          await gate
          return route.fulfill({
            status: 503,
            contentType: 'application/json',
            body: JSON.stringify({
              message: 'Appearance service unavailable. Please retry.'
            })
          })
        }
        return route.continue()
      })
      await name.fill('A changed app')
      await save.click()
      await expect(
        page.raw.getByRole('button', { name: 'Saving…', exact: true })
      ).toBeDisabled()
      await expect(name).toBeDisabled()
      await expect(
        page.raw.getByRole('button', { name: 'Reset to defaults', exact: true })
      ).toBeDisabled()
      release()
      await expect(
        page.raw
          .locator('[data-slot="toast"]')
          .getByText('Appearance service unavailable. Please retry.', {
            exact: true
          })
      ).toBeVisible()
      await expect(name).toHaveValue('A changed app')
      await expect(save).toBeEnabled()
      expect(attempts).toBe(1)
      await save.click()
      await expect(
        page.raw
          .locator('[data-slot="toast"]')
          .getByText('App appearance saved.', { exact: true })
      ).toBeVisible()
      await expect(save).toBeDisabled()
      expect(attempts).toBe(2)
      await page.raw.reload()
      await expect(name).toHaveValue('A changed app')
      await expect(save).toBeDisabled()
      const output = path.resolve('.tmp/screenshots/appearance-followup')
      fs.mkdirSync(output, { recursive: true })
      for (const colorScheme of ['light', 'dark']) {
        await page.raw.emulateMedia({ colorScheme })
        await page.raw.evaluate(async () => {
          await Promise.all(
            document
              .getAnimations()
              .filter((a) => a.effect?.getTiming().iterations !== Infinity)
              .map((a) => a.finished.catch(() => {}))
          )
        })
        await page.screenshot(
          path.join(output, `${browser}-${colorScheme}-appearance.png`)
        )
      }
      expect(
        await page.raw.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth
        )
      ).toBe(true)
      expect(page).toHaveNoJavascriptErrors()
    }
  )
