const fs = require('node:fs')
const path = require('node:path')
const { test } = require('sounding')
const contract = require('../../../../api/lib/app-appearance')
const brands = require('../../../fixtures/appearance/brands.json')
test(
  'App appearance previews drafts and persists app-scoped branding across Bearing',
  {
    browser: true,
    world: {
      name: 'configured-slipway',
      context: { deploymentTarget: { slug: 'appearance-qa', name: 'Tembo' } }
    }
  },
  async ({ sails, world, login, page, expect }) => {
    const current = world.current,
      app = current.apps.web,
      env = current.environments.production,
      project = current.projects.deploymentTarget
    const root = path.resolve('.tmp/screenshots/issue-875')
    fs.mkdirSync(root, { recursive: true })
    await sails.models.app
      .updateOne({ id: app.id })
      .set({ bearingEnabled: true })
    const space = await sails.models.bearingspace
      .create({
        publicSlug: 'appearance-qa',
        app: app.id,
        createdBy: current.users.genesisUser.id,
        widgetEnabled: true,
        allowAnonymousParticipation: true
      })
      .fetch()
    await sails.models.bearingfeedback.create({
      title: 'A shared workspace for every project',
      details: 'Keep the team in sync without another round of messages.',
      app: app.id,
      space: space.id,
      status: 'planned',
      voteCount: 18
    })
    await sails.models.bearingupdate.create({
      title: 'A calmer way to create',
      slug: 'a-calmer-way',
      excerpt: 'Your ideas, conversations and projects, together in one place.',
      body: '## More room for your ideas\n\nBring your next project to life with a simpler workspace.',
      status: 'published',
      publishedAt: Date.now(),
      author: current.users.genesisUser.id,
      app: app.id,
      space: space.id
    })
    let privatePath = `/_slipway/bearing/host/${project.slug}/${env.slug}/${app.slug}`
    await page.raw.route('**/bearing/**', async (route) => {
      const url = new URL(route.request().url())
      if (url.pathname.startsWith('/bearing/'))
        url.pathname = privatePath + url.pathname.slice('/bearing'.length)
      else if (url.pathname.startsWith('/_slipway/bearing/_assets/'))
        url.pathname = url.pathname.replace('/_slipway/bearing/_assets', '')
      else if (
        /^\/_slipway\/bearing\/(bootstrap.js|widget-config|widget.css|appearance.css)$/.test(
          url.pathname
        )
      )
        url.pathname = privatePath + '/' + url.pathname.split('/').pop()
      await route.continue({ url: url.toString() })
    })
    await login.withPassword('genesisUser', page, {
      password: current.auth.genesisUserPassword
    })
    const base = `/projects/${project.slug}/environments/${env.slug}/apps/${app.slug}`
    const errors = []
    page.raw.on('pageerror', (error) => errors.push(error.message))
    await page.resize(1440, 1100)
    await page.goto(`${base}/appearance`)
    await expect(page).toSee('App appearance')
    await page.raw.locator('#appearance-name').fill('Tembo')
    for (const palette of ['light', 'dark']) {
      await page.raw
        .getByRole('button', { name: new RegExp('^' + palette + '$', 'i') })
        .first()
        .click()
      for (const [token, value] of Object.entries(brands.tembo[palette]))
        await page.raw
          .getByLabel(
            `${palette} ${
              {
                canvas: 'Background',
                surface: 'Surface',
                text: 'Text',
                mutedText: 'Secondary text',
                border: 'Border',
                accent: 'Accent',
                accentText: 'On accent',
                focus: 'Focus ring'
              }[token]
            }`,
            { exact: true }
          )
          .fill(value)
    }
    await page.raw
      .getByRole('button', { name: /^light$/i })
      .first()
      .click()
    await page.raw
      .locator('#appearance-logoLight')
      .setInputFiles(path.resolve('tests/fixtures/appearance/tembo-logo.png'))
    await page.raw
      .locator('#appearance-logoDark')
      .setInputFiles(
        path.resolve('tests/fixtures/appearance/tembo-logo-dark.png')
      )
    await page.raw.locator('#appearance-mode').click()
    await page.raw
      .getByRole('option', { name: 'Follow app', exact: true })
      .click()
    expect(
      await sails.models.setting.count({ key: `app-appearance:v1:${app.id}` })
    ).toBe(0)
    await page.raw.waitForTimeout(1000)

    await page.raw.waitForTimeout(250)
    await page.raw.screenshot({
      path: path.join(root, 'tembo-settings-light.png'),
      fullPage: true
    })
    await page.raw.emulateMedia({ colorScheme: 'dark' })
    await page.raw
      .getByRole('button', { name: /^dark$/i })
      .last()
      .click()
    await page.raw.waitForTimeout(250)
    await page.raw.screenshot({
      path: path.join(root, 'tembo-settings-dark.png'),
      fullPage: true
    })
    await page.raw
      .getByRole('button', { name: 'Save appearance', exact: true })
      .click()
    await expect(
      page.raw.getByText('Appearance saved.', { exact: true })
    ).toBeVisible()
    await page.raw.reload()
    await expect(page.raw.locator('#appearance-name')).toHaveValue('Tembo')
    await page.raw.emulateMedia({ colorScheme: 'light' })
    await page.goto('/bearing/feedback')
    await expect(page).toSee('Tembo')
    await page.raw.waitForTimeout(250)
    await page.raw.screenshot({
      path: path.join(root, 'tembo-public-light.png'),
      fullPage: true
    })
    await page.raw.emulateMedia({ colorScheme: 'dark' })
    await page.raw.waitForTimeout(250)
    await page.raw.screenshot({
      path: path.join(root, 'tembo-public-dark.png'),
      fullPage: true
    })
    await page.raw.evaluate(() => {
      const b = document.createElement('button')
      b.textContent = 'Open feedback'
      b.setAttribute('data-slipway-bearing-open', 'feedback')
      document.body.prepend(b)
      const s = document.createElement('script')
      s.src = '/_slipway/bearing/bootstrap.js'
      document.body.append(s)
    })
    await page.raw.waitForSelector('[data-slipway-bearing-widget]', {
      state: 'attached'
    })
    await page.raw
      .getByRole('button', { name: 'Open feedback', exact: true })
      .click()
    await expect(
      page.raw.locator('[data-slipway-bearing-widget]').locator('dialog')
    ).toBeVisible()
    const widgetRoot = page.raw.locator('[data-slipway-bearing-widget]')
    expect(await widgetRoot.locator('style').count()).toBe(0)
    const content = page.raw.frameLocator(
      '[data-slipway-bearing-widget] iframe'
    )
    await expect(content.locator('.app-appearance').first()).toHaveAttribute(
      'data-appearance-mode',
      'dark'
    )
    await page.raw.evaluate(() => {
      document.documentElement.dataset.theme = 'light'
    })
    await expect(widgetRoot).toHaveAttribute('data-appearance-mode', 'light')
    await expect(content.locator('.app-appearance').first()).toHaveAttribute(
      'data-appearance-mode',
      'light'
    )
    // A same-origin message from the frame itself is not the trusted parent.
    await content
      .locator('body')
      .evaluate(() =>
        window.postMessage(
          { type: 'slipway:appearance', version: 1, mode: 'dark' },
          window.location.origin
        )
      )
    await expect(content.locator('.app-appearance').first()).toHaveAttribute(
      'data-appearance-mode',
      'light'
    )
    await page.raw.evaluate(() => {
      document.documentElement.dataset.theme = 'dark'
    })
    await expect(content.locator('.app-appearance').first()).toHaveAttribute(
      'data-appearance-mode',
      'dark'
    )
    await page.raw.waitForTimeout(600)
    await page.raw.waitForTimeout(250)
    await page.raw.screenshot({
      path: path.join(root, 'tembo-widget-dark.png')
    })
    await page.raw
      .locator('[data-slipway-bearing-widget]')
      .getByRole('button', { name: 'Roadmap', exact: true })
      .click()
    await page.raw
      .locator('[data-slipway-bearing-widget]')
      .getByRole('button', { name: 'Updates', exact: true })
      .click()
    await content
      .getByRole('link', { name: 'A calmer way to create', exact: true })
      .click()
    await expect(
      content.getByRole('heading', {
        name: 'A calmer way to create',
        exact: true
      })
    ).toBeVisible()
    await expect(content.locator('.app-appearance').first()).toHaveAttribute(
      'data-appearance-mode',
      'dark'
    )
    await expect(
      content.getByRole('navigation', { name: 'Bearing', exact: true })
    ).toHaveCount(0)
    await page.raw
      .locator('[data-slipway-bearing-widget]')
      .getByRole('button', { name: 'Close', exact: true })
      .click()
    await expect(
      page.raw.locator('[data-slipway-bearing-widget]').locator('dialog')
    ).not.toBeVisible()
    await page.raw.emulateMedia({ colorScheme: 'light' })
    await page.raw.evaluate(() => {
      document.documentElement.dataset.theme = 'light'
    })
    await page.raw
      .getByRole('button', { name: 'Open feedback', exact: true })
      .click()
    await page.raw.waitForTimeout(500)
    await page.raw.waitForTimeout(250)
    await page.raw.screenshot({
      path: path.join(root, 'tembo-widget-light.png')
    })
    await page.raw.keyboard.press('Escape')
    await page.resize(390, 844)
    await page.raw
      .getByRole('button', { name: 'Open feedback', exact: true })
      .click()
    await expect(widgetRoot.locator('dialog')).toBeVisible()
    await page.raw.waitForTimeout(250)
    await page.raw.waitForTimeout(250)
    await page.raw.screenshot({
      path: path.join(root, 'tembo-widget-mobile.png')
    })
    await page.raw.keyboard.press('Escape')
    await expect(widgetRoot.locator('dialog')).not.toBeVisible()
    await page.resize(1440, 1100)

    // Unsaved changes stay local; the reset draft also requires Save.
    await page.goto(`${base}/appearance`)
    await page.raw
      .getByRole('button', { name: 'Reset to defaults', exact: true })
      .click()
    await page.raw.reload()
    await expect(page.raw.locator('#appearance-name')).toHaveValue('Tembo')
    await page.raw
      .getByRole('button', { name: 'Reset to defaults', exact: true })
      .click()
    await page.raw
      .getByRole('button', { name: 'Save appearance', exact: true })
      .click()
    await expect(
      page.raw.getByText('Appearance saved.', { exact: true })
    ).toBeVisible()
    await page.raw.reload()
    await expect(page.raw.locator('#appearance-name')).toHaveValue('Tembo')
    expect(
      await sails.models.setting.count({ key: `app-appearance:v1:${app.id}` })
    ).toBe(1)

    const other = await world.create('app').with({
      name: 'Northstar',
      slug: 'northstar',
      environment: env.id,
      bearingEnabled: true
    })
    await sails.models.bearingspace.create({
      publicSlug: 'northstar-appearance',
      app: other.id,
      createdBy: current.users.genesisUser.id,
      widgetEnabled: true,
      allowAnonymousParticipation: true
    })
    await sails.helpers.setting.set(
      `app-appearance:v1:${other.id}`,
      JSON.stringify({
        ...contract.normalize(),
        ...brands.northstar,
        logoLight: null,
        logoDark: null
      })
    )
    privatePath = `/_slipway/bearing/host/${project.slug}/${env.slug}/${other.slug}`
    await page.raw.emulateMedia({ colorScheme: 'light' })
    await page.goto('/bearing/feedback')
    await expect(page).toSee('Northstar')
    await page.raw.waitForTimeout(250)
    await page.raw.screenshot({
      path: path.join(root, 'northstar-public-light.png'),
      fullPage: true
    })
    await page.raw.emulateMedia({ colorScheme: 'dark' })
    await page.raw.waitForTimeout(250)
    await page.raw.screenshot({
      path: path.join(root, 'northstar-public-dark.png'),
      fullPage: true
    })
    await page.resize(390, 844)
    await page.raw.waitForTimeout(250)
    await page.raw.screenshot({
      path: path.join(root, 'northstar-public-mobile-dark.png'),
      fullPage: true
    })
    // Explicit modes override the visitor's opposite system preference.
    await sails.helpers.setting.set(
      `app-appearance:v1:${other.id}`,
      JSON.stringify({
        ...contract.normalize(),
        ...brands.northstar,
        mode: 'light',
        logoLight: null,
        logoDark: null
      })
    )
    await page.raw.emulateMedia({ colorScheme: 'dark' })
    await page.goto('/bearing/feedback')
    await expect(page.raw.locator('.app-appearance').first()).toHaveAttribute(
      'data-appearance-mode',
      'light'
    )
    await expect(page.raw.locator('.min-h-screen').first()).toHaveCSS(
      'background-color',
      'rgb(248, 247, 252)'
    )
    await sails.helpers.setting.set(
      `app-appearance:v1:${other.id}`,
      JSON.stringify({
        ...contract.normalize(),
        ...brands.northstar,
        mode: 'dark',
        logoLight: null,
        logoDark: null
      })
    )
    await page.raw.emulateMedia({ colorScheme: 'light' })
    await page.raw.reload()
    await expect(page.raw.locator('.app-appearance').first()).toHaveAttribute(
      'data-appearance-mode',
      'dark'
    )
    await expect(page.raw.locator('.min-h-screen').first()).toHaveCSS(
      'background-color',
      'rgb(16, 12, 27)'
    )
    expect(errors).toEqual([])
  }
)
