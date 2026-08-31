const fs = require('node:fs')
const path = require('node:path')
const { test } = require('sounding')

test(
  'Bearing update editor keeps inputs clean and rejects incomplete public storage',
  {
    browser: true,
    world: {
      name: 'configured-slipway',
      context: {
        deploymentTarget: {
          slug: 'bearing-update-storage',
          name: 'Bearing Update Storage'
        }
      }
    }
  },
  async ({ sails, world, login, page, expect }) => {
    const current = world.current
    const project = current.projects.deploymentTarget
    const environment = current.environments.production
    const app = current.apps.web
    const screenshotRoot = path.resolve(
      '.tmp/screenshots/issue-502-bearing-update-editor'
    )
    fs.mkdirSync(screenshotRoot, { recursive: true })

    await sails.models.app
      .updateOne({ id: app.id })
      .set({ bearingEnabled: true })
    await sails.models.bearingspace.create({
      publicSlug: 'bearing-update-storage',
      app: app.id,
      createdBy: current.users.genesisUser.id
    })
    await sails.helpers.setting.set(
      'globalEnvVars',
      JSON.stringify({
        R2_ACCESS_KEY: 'test-key',
        R2_SECRET_KEY: 'test-secret',
        R2_BUCKET: 'slipway-test',
        R2_ENDPOINT: 'https://account.r2.cloudflarestorage.com'
      })
    )

    await login.withPassword('genesisUser', page, {
      password: current.auth.genesisUserPassword
    })
    const bearingPath = `/projects/${project.slug}/environments/${environment.slug}/apps/${app.slug}/bearing`
    const uploadPath = `/api/v1/projects/${project.slug}/environments/${environment.slug}/apps/${app.slug}/bearing/updates/images`
    await page.resize(1440, 1000)
    await page.goto(`${bearingPath}?view=updates`)

    await expect(page).toSee('Images need public file storage.')
    await expect(
      page.raw.getByRole('link', { name: 'Finish setup' })
    ).toHaveAttribute('href', '/settings/uploads')
    await expect(
      page.raw.locator(
        '[data-test="bearing-update-body-image-upload"] input[type="file"]'
      )
    ).toHaveCount(0)

    const updateTitle = page.raw.locator('#bearing-update-title')
    const updateExcerpt = page.raw.locator('#bearing-update-excerpt')
    await updateTitle.fill('Rich updates can carry images')
    expect(
      await updateTitle.evaluate(
        (element) => getComputedStyle(element).outlineStyle
      )
    ).toBe('none')
    expect(
      await updateTitle.evaluate(
        (element) => getComputedStyle(element).borderBottomStyle
      )
    ).toBe('dashed')
    await updateExcerpt.fill('Public upload readiness is explicit.')
    expect(
      await updateExcerpt.evaluate(
        (element) => getComputedStyle(element).outlineStyle
      )
    ).toBe('none')

    await page.screenshot(path.join(screenshotRoot, 'after-light.png'), {
      fullPage: true,
      animations: 'disabled'
    })
    await page.raw.emulateMedia({ colorScheme: 'dark' })
    await page.screenshot(path.join(screenshotRoot, 'after-dark.png'), {
      fullPage: true,
      animations: 'disabled'
    })
    await page.raw.emulateMedia({ colorScheme: 'light' })
    await page.resize(390, 844)
    await updateExcerpt.scrollIntoViewIfNeeded()
    await page.screenshot(path.join(screenshotRoot, 'after-mobile.png'), {
      fullPage: true,
      animations: 'disabled'
    })

    const uploadResponse = await page.raw.evaluate(async (url) => {
      const form = new FormData()
      form.append(
        'image',
        new File(['image bytes'], 'release.png', { type: 'image/png' })
      )
      const response = await fetch(url, { method: 'POST', body: form })
      return { status: response.status, body: await response.json() }
    }, uploadPath)

    expect(uploadResponse.status).toBe(503)
    expect(uploadResponse.body.code).toBe(
      'PUBLIC_UPLOAD_STORAGE_NOT_CONFIGURED'
    )
    expect(uploadResponse.body.message).toContain('public URL')
    expect(uploadResponse.body.settingsUrl).toBe('/settings/uploads')
    expect(page).toHaveNoJavascriptErrors()
  }
)
