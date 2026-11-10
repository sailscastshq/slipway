const { test } = require('sounding')
const fs = require('node:fs')
const path = require('node:path')
const contract = require('../../../../api/lib/app-appearance')

test(
  'Shared branding previews Bridge, Bearing and Beacon without changing saved settings or enabling products',
  {
    browser: true,
    world: {
      name: 'configured-slipway',
      context: { deploymentTarget: { slug: 'shared-branding', name: 'Harbor' } }
    }
  },
  async ({ sails, world, login, page, expect }) => {
    const { apps, projects, environments, auth } = world.current
    const app = apps.web
    const key = `app-appearance:v1:${app.id}`
    const original = JSON.stringify({
      ...contract.normalize({}, 'Harbor'),
      mode: 'host',
      fallbackMode: 'dark'
    })
    await sails.helpers.setting.set(key, original)
    await login.withPassword('genesisUser', page, {
      password: auth.genesisUserPassword
    })
    const base = `/projects/${projects.deploymentTarget.slug}/environments/${environments.production.slug}/apps/${app.slug}`
    await page.goto(`${base}/appearance`)
    await page.resize(1440, 1100)
    await expect(
      page.raw.getByRole('heading', {
        name: 'Branding & appearance',
        exact: true
      })
    ).toBeVisible()
    await expect(
      page.raw.getByText(/Save once to update every enabled/)
    ).toBeVisible()
    await expect(page.raw.locator('#appearance-fallback')).toHaveText('Dark')
    const preview = page.raw.frameLocator(
      'iframe[title="Draft appearance preview"]'
    )
    const select = async (product) => {
      await page.raw.getByRole('button', { name: product, exact: true }).click()
      if (product === 'Bearing')
        await page.raw
          .getByRole('button', { name: 'Public page', exact: true })
          .click()
      await expect(preview.locator('.app-appearance').first()).toBeVisible()
    }
    const mode = async (value) => {
      await page.raw
        .getByRole('button', { name: new RegExp(`^${value}$`, 'i') })
        .last()
        .click()
      await expect(preview.locator('.app-appearance').first()).toHaveAttribute(
        'data-appearance-mode',
        value
      )
    }
    for (const product of ['Bridge', 'Bearing', 'Beacon']) {
      await select(product)
      await expect(preview.locator('.app-brand').first()).toContainText(
        'Harbor'
      )
      await expect(preview.locator('.app-brand img')).toHaveCount(0)
    }
    await page.raw.locator('#appearance-name').fill('Harbor Studio')
    await page.raw
      .locator('#appearance-logoLight')
      .setInputFiles(path.resolve('tests/fixtures/appearance/tembo-logo.png'))
    for (const product of ['Bridge', 'Bearing', 'Beacon']) {
      await select(product)
      await mode('dark')
      await expect(preview.locator('.app-brand-single').first()).toHaveCSS(
        'background-color',
        'rgb(255, 255, 255)'
      )
      await expect(preview.locator('.app-logo-light').first()).toBeVisible()
    }
    await page.raw
      .locator('#appearance-logoDark')
      .setInputFiles(
        path.resolve('tests/fixtures/appearance/tembo-logo-dark.png')
      )
    const output = path.resolve('.tmp/screenshots/shared-branding')
    fs.mkdirSync(output, { recursive: true })
    for (const product of ['Bridge', 'Bearing', 'Beacon']) {
      await select(product)
      for (const theme of ['light', 'dark']) {
        await page.raw.emulateMedia({
          colorScheme: theme === 'light' ? 'dark' : 'light'
        })
        await mode(theme)
        await expect(
          preview.locator(`.app-logo-${theme}`).first()
        ).toBeVisible()
        await expect(
          preview
            .locator(`.app-logo-${theme === 'light' ? 'dark' : 'light'}`)
            .first()
        ).not.toBeVisible()
        await expect(preview.locator('.app-brand').first()).toContainText(
          'Harbor Studio'
        )
        if (product === 'Beacon') {
          await expect(
            preview.getByRole('heading', { name: 'Unknown', exact: true })
          ).toBeVisible()
          await expect(
            preview.getByText(/independent checker is/)
          ).toBeVisible()
        }
        if (product === 'Bridge')
          await expect(
            preview.getByText('Submissions', { exact: true }).last()
          ).toBeVisible()
        await page.raw.emulateMedia({ colorScheme: theme })
        await page.screenshot(
          path.join(output, `${product.toLowerCase()}-${theme}.png`),
          { animations: 'disabled' }
        )
      }
    }
    expect((await sails.models.setting.findOne({ key })).value).toBe(original)
    const before = await sails.models.app.findOne({ id: app.id })
    expect(Boolean(before.bearingEnabled)).toBe(false)
    expect(Boolean(before.bridgeEnabled)).toBe(false)
    expect(
      await sails.models.setting.count({ key: `beacon.public.app:${app.id}` })
    ).toBe(0)
    await page.raw.getByRole('button', { name: 'Save', exact: true }).click()
    await expect(
      page.raw.getByRole('button', { name: 'Save', exact: true })
    ).toBeDisabled()
    await page.raw.reload()
    await expect(page.raw.locator('#appearance-name')).toHaveValue(
      'Harbor Studio'
    )
    await expect(page.raw.locator('#appearance-fallback')).toHaveText('Dark')
    for (const product of ['Bridge', 'Bearing', 'Beacon']) {
      await select(product)
      await mode('dark')
      await expect(preview.locator('.app-logo-dark').first()).toBeVisible()
      await expect(preview.locator('.app-brand').first()).toContainText(
        'Harbor Studio'
      )
    }
    await page.resize(390, 844)
    await page.raw.getByRole('button', { name: 'Mobile', exact: true }).click()
    await page.raw
      .getByRole('group', { name: 'Product preview' })
      .evaluate((element) => element.scrollIntoView({ block: 'start' }))
    expect(
      await page.raw.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth
      )
    ).toBe(true)
    await page.screenshot(path.join(output, 'beacon-mobile.png'), {
      animations: 'disabled'
    })
    expect(page).toHaveNoJavascriptErrors()
  }
)
