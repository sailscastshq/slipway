const fs = require('node:fs')
const path = require('node:path')
const { test } = require('sounding')
const { Resvg } = require('@resvg/resvg-js')
const previewImageUrl = 'https://assets.example.test/bearing/preview.png'
const previewImage =
  '<svg xmlns="http://www.w3.org/2000/svg" width="320" height="200" viewBox="0 0 320 200"><rect width="320" height="200" rx="12" fill="#f3f4f6"/><rect x="18" y="18" width="284" height="164" rx="8" fill="white"/><rect x="18" y="18" width="284" height="26" fill="#111827"/><circle cx="34" cy="31" r="4" fill="#9ca3af"/><rect x="38" y="63" width="117" height="12" rx="6" fill="#374151"/><rect x="38" y="88" width="240" height="8" rx="4" fill="#d1d5db"/><rect x="38" y="104" width="204" height="8" rx="4" fill="#d1d5db"/><rect x="38" y="130" width="90" height="30" rx="7" fill="#2563eb"/></svg>'

test(
  'Bearing drafts reopen with their content and can be saved, published, or deleted',
  {
    browser: true,
    world: {
      name: 'configured-slipway',
      context: {
        deploymentTarget: {
          slug: 'bearing-draft-editor',
          name: 'Bearing Draft Editor'
        }
      }
    }
  },
  async ({ sails, world, login, page, expect }) => {
    const current = world.current
    const app = current.apps.web
    const environment = current.environments.production
    const project = current.projects.deploymentTarget
    const author = current.users.genesisUser
    const space = await sails.models.bearingspace
      .create({
        publicSlug: 'bearing-draft-editor',
        app: app.id,
        createdBy: author.id
      })
      .fetch()
    const feedback = await sails.models.bearingfeedback
      .create({
        title: 'Stop duplicate invoices',
        category: 'bug',
        app: app.id,
        space: space.id
      })
      .fetch()
    const draft = await sails.models.bearingupdate
      .create({
        title: 'Invoice lists now stop at the end',
        slug: 'invoice-lists-now-stop-at-the-end',
        excerpt: 'Background refreshes no longer duplicate invoices.',
        body: `The invoice list keeps its place.\n\n![Invoice preview](${previewImageUrl})`,
        status: 'draft',
        author: author.id,
        app: app.id,
        space: space.id
      })
      .fetch()
    await sails.models.bearingupdatelink.create({
      linkKey: 'bearing-draft-editor-link',
      update: draft.id,
      feedback: feedback.id,
      space: space.id
    })

    await login.withPassword('genesisUser', page, {
      password: current.auth.genesisUserPassword
    })
    await page.raw.route(previewImageUrl, (route) =>
      route.fulfill({
        status: 200,
        contentType: 'image/png',
        body: new Resvg(previewImage).render().asPng()
      })
    )
    const bearingPath = `/projects/${project.slug}/environments/${environment.slug}/apps/${app.slug}/bearing`
    await page.goto(`${bearingPath}?view=updates`)

    await page.raw
      .getByRole('button', { name: `Edit draft ${draft.title}` })
      .click()
    await expect(page.raw.locator('#bearing-update-title')).toHaveValue(
      draft.title
    )
    await expect(page.raw.locator('#bearing-update-excerpt')).toHaveValue(
      draft.excerpt
    )
    await expect(
      page.raw.locator('[data-test="bearing-update-body-visual-editor"]')
    ).toContainText('The invoice list keeps its place.')
    const draftImage = page.raw.locator(
      '[data-test="bearing-update-body-visual-editor"] img'
    )
    await expect(draftImage).toHaveAttribute('src', previewImageUrl)
    await draftImage.evaluate((image) => image.decode())
    expect(await draftImage.evaluate((image) => image.naturalWidth)).toBe(320)
    await expect(page.raw.getByLabel(feedback.title)).toBeChecked()
    const screenshotRoot = path.resolve(
      '.tmp/screenshots/issue-606-bearing-drafts'
    )
    fs.mkdirSync(screenshotRoot, { recursive: true })
    await page.resize(1440, 1000)
    await page.screenshot(path.join(screenshotRoot, 'draft-prefilled.png'), {
      fullPage: true,
      animations: 'disabled'
    })

    await page.raw.getByRole('button', { name: 'Edit image' }).click()
    const imageDialog = page.raw.getByRole('dialog', { name: 'Edit image' })
    await imageDialog
      .getByPlaceholder('What does this image show?')
      .fill('Invoice pagination preview')
    // Hold application frame callbacks so a user can move focus before the
    // image command's deferred editor focus runs. No timing sleep is needed.
    await page.raw.evaluate(() => {
      window.bearingFrames = []
      window.bearingRequestFrame = window.requestAnimationFrame
      window.requestAnimationFrame = (callback) => {
        window.bearingFrames.push(callback)
        return window.bearingRequestFrame(() => {})
      }
    })
    await imageDialog.getByRole('button', { name: 'Update image' }).click()
    const titleInput = page.raw.locator('#bearing-update-title')
    await titleInput.click()
    await page.raw.evaluate(() => {
      window.requestAnimationFrame = window.bearingRequestFrame
      const frames = window.bearingFrames
      delete window.bearingFrames
      delete window.bearingRequestFrame
      for (const callback of frames) callback(performance.now())
    })
    await expect(titleInput).toBeFocused()

    await page.raw
      .locator('#bearing-update-title')
      .fill('Invoice lists keep their place')
    await page.raw
      .locator('#bearing-update-excerpt')
      .fill('Pagination now stays at the end.')
    await page.raw.getByRole('button', { name: 'Save changes' }).click()
    await expect(page.raw.locator('#bearing-update-title')).toHaveValue('')
    const saved = await sails.models.bearingupdate.findOne({ id: draft.id })
    expect(saved.title).toBe('Invoice lists keep their place')
    expect(saved.excerpt).toBe('Pagination now stays at the end.')
    expect(saved.body).toContain(previewImageUrl)
    expect(saved.body).toContain('Invoice pagination preview')
    expect(await sails.models.bearingupdate.count({ space: space.id })).toBe(1)

    await page.raw
      .getByRole('button', { name: `Edit draft ${saved.title}` })
      .click()
    await page.raw.getByRole('button', { name: 'Publish update' }).click()
    await expect(
      page.raw.getByRole('button', { name: `Edit draft ${saved.title}` })
    ).toHaveCount(0)
    expect(
      (await sails.models.bearingupdate.findOne({ id: draft.id })).status
    ).toBe('published')
    expect(
      (await sails.models.bearingfeedback.findOne({ id: feedback.id })).status
    ).toBe('shipped')

    const disposable = await sails.models.bearingupdate
      .create({
        title: 'Discard this draft',
        slug: 'discard-this-draft',
        excerpt: 'A temporary update.',
        body: 'This update will be removed.',
        status: 'draft',
        author: author.id,
        app: app.id,
        space: space.id
      })
      .fetch()
    await page.goto(`${bearingPath}?view=updates`)
    await page.raw
      .getByRole('button', { name: `Edit draft ${disposable.title}` })
      .click()
    await page.raw.getByRole('button', { name: 'Draft actions' }).click()
    await page.raw.waitForFunction(() => {
      const menu = document.querySelector('[data-test="bearing-draft-actions"]')
      const trigger = document.querySelector(
        '[data-test="bearing-draft-actions-trigger"]'
      )
      if (!menu || !trigger) return false
      return (
        Math.abs(
          menu.getBoundingClientRect().right -
            trigger.getBoundingClientRect().right
        ) < 24
      )
    })
    await page.screenshot(path.join(screenshotRoot, 'draft-actions.png'), {
      fullPage: true,
      animations: 'disabled'
    })
    await page.raw.locator('[data-test="bearing-draft-actions-delete"]').click()
    await page.raw
      .getByRole('button', { name: 'Delete draft', exact: true })
      .last()
      .click()
    await expect(
      page.raw.getByRole('button', { name: `Edit draft ${disposable.title}` })
    ).toHaveCount(0)
    expect(
      Boolean(await sails.models.bearingupdate.findOne({ id: disposable.id }))
    ).toBe(false)

    await sails.helpers.setting.set(
      'globalEnvVars',
      JSON.stringify({
        R2_ACCESS_KEY: 'test-key',
        R2_SECRET_KEY: 'test-secret',
        R2_BUCKET: 'slipway-test',
        R2_ENDPOINT: 'https://r2.example.test',
        R2_PUBLIC_URL: 'https://assets.example.test'
      })
    )
    const directory = `bearing/teams/${author.team}/projects/${project.id}/apps/${app.id}/updates/assets`
    const uniquePath = `${directory}/11111111-1111-4111-8111-111111111111.png`
    const sharedPath = `${directory}/22222222-2222-4222-8222-222222222222.png`
    const ownedDraft = await sails.models.bearingupdate
      .create({
        title: 'Draft with owned images',
        slug: 'draft-with-owned-images',
        excerpt: 'Images should be cleaned up.',
        body: `![Unique](https://assets.example.test/${uniquePath})\n\n![Shared](https://assets.example.test/${sharedPath})`,
        status: 'draft',
        author: author.id,
        app: app.id,
        space: space.id
      })
      .fetch()
    await sails.models.bearingupdate.create({
      title: 'Published update using the shared image',
      slug: 'published-update-using-the-shared-image',
      excerpt: 'Keep this image.',
      body: `![Shared](https://assets.example.test/${sharedPath})`,
      status: 'published',
      publishedAt: Date.now(),
      author: author.id,
      app: app.id,
      space: space.id
    })
    const originalDeleteImages = sails.helpers.bearing.deleteFeedbackImages
    const removed = []
    try {
      sails.helpers.bearing.deleteFeedbackImages = {
        with: async ({ images }) => removed.push(...images)
      }
      await page.goto(`${bearingPath}?view=updates`)
      await page.raw
        .getByRole('button', { name: `Edit draft ${ownedDraft.title}` })
        .click()
      await page.raw.getByRole('button', { name: 'Draft actions' }).click()
      await page.raw
        .locator('[data-test="bearing-draft-actions-delete"]')
        .click()
      await Promise.all([
        page.raw.waitForResponse(
          (response) =>
            response.url().includes(`/updates/${ownedDraft.publicId}`) &&
            response.request().method() === 'DELETE'
        ),
        page.raw
          .getByRole('button', { name: 'Delete draft', exact: true })
          .last()
          .click()
      ])
      await expect(
        page.raw.getByRole('button', { name: `Edit draft ${ownedDraft.title}` })
      ).toHaveCount(0)
    } finally {
      sails.helpers.bearing.deleteFeedbackImages = originalDeleteImages
    }
    expect(removed).toEqual([{ objectPath: uniquePath }])
    expect(
      Boolean(await sails.models.bearingupdate.findOne({ id: ownedDraft.id }))
    ).toBe(false)

    const retryDraft = await sails.models.bearingupdate
      .create({
        title: 'Retry image cleanup',
        slug: 'retry-image-cleanup',
        excerpt: 'Storage may be unavailable.',
        body: `![Unique](https://assets.example.test/${uniquePath})`,
        status: 'draft',
        author: author.id,
        app: app.id,
        space: space.id
      })
      .fetch()
    try {
      sails.helpers.bearing.deleteFeedbackImages = {
        with: async () => {
          throw new Error('Storage unavailable')
        }
      }
      await page.goto(`${bearingPath}?view=updates`)
      await page.raw
        .getByRole('button', { name: `Edit draft ${retryDraft.title}` })
        .click()
      await page.raw.getByRole('button', { name: 'Draft actions' }).click()
      await page.raw
        .locator('[data-test="bearing-draft-actions-delete"]')
        .click()
      await Promise.all([
        page.raw.waitForResponse(
          (response) =>
            response.url().includes(`/updates/${retryDraft.publicId}`) &&
            response.request().method() === 'DELETE'
        ),
        page.raw
          .getByRole('button', { name: 'Delete draft', exact: true })
          .last()
          .click()
      ])
      await expect(
        page.raw.getByRole('button', { name: `Edit draft ${retryDraft.title}` })
      ).toHaveCount(1)
    } finally {
      sails.helpers.bearing.deleteFeedbackImages = originalDeleteImages
    }
    expect(
      Boolean(await sails.models.bearingupdate.findOne({ id: retryDraft.id }))
    ).toBe(true)
    expect(page).toHaveNoJavascriptErrors()
  }
)

test(
  'Bearing update images retain their aspect ratio from upload through publication',
  {
    browser: true,
    world: {
      name: 'configured-slipway',
      context: {
        deploymentTarget: {
          slug: 'bearing-image-sizing',
          name: 'Bearing Image Sizing'
        }
      }
    }
  },
  async ({ sails, world, login, page, expect }) => {
    const current = world.current
    const app = current.apps.web
    const environment = current.environments.production
    const project = current.projects.deploymentTarget
    const author = current.users.genesisUser
    await sails.models.app
      .updateOne({ id: app.id })
      .set({ bearingEnabled: true })
    const space = await sails.models.bearingspace
      .create({
        publicSlug: 'bearing-image-sizing',
        app: app.id,
        createdBy: author.id
      })
      .fetch()
    await sails.helpers.setting.set(
      'globalEnvVars',
      JSON.stringify({
        R2_ACCESS_KEY: 'test-key',
        R2_SECRET_KEY: 'test-secret',
        R2_BUCKET: 'slipway-test',
        R2_ENDPOINT: 'https://r2.example.test',
        R2_PUBLIC_URL: 'https://assets.example.test'
      })
    )
    const fixtures = [
      { name: 'tall', width: 600, height: 1800 },
      { name: 'small', width: 120, height: 80 },
      { name: 'wide', width: 1800, height: 400 }
    ].map((fixture) => ({
      ...fixture,
      url: `https://assets.example.test/bearing/${fixture.name}.png`,
      buffer: new Resvg(
        `<svg xmlns="http://www.w3.org/2000/svg" width="${
          fixture.width
        }" height="${
          fixture.height
        }"><rect width="100%" height="100%" fill="#e5e7eb"/><rect width="100%" height="40" fill="#2563eb"/><rect y="${
          fixture.height - 40
        }" width="100%" height="40" fill="#dc2626"/></svg>`
      )
        .render()
        .asPng()
    }))
    for (const fixture of fixtures) {
      await page.raw.route(fixture.url, (route) =>
        route.fulfill({
          status: 200,
          contentType: 'image/png',
          body: fixture.buffer
        })
      )
    }
    let uploadIndex = 0
    await page.raw.route('**/bearing/updates/images', (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ imageUrl: fixtures[uploadIndex++].url })
      })
    )
    await login.withPassword('genesisUser', page, {
      password: current.auth.genesisUserPassword
    })
    const bearingPath = `/projects/${project.slug}/environments/${environment.slug}/apps/${app.slug}/bearing`
    await page.resize(1440, 1000)
    await page.goto(`${bearingPath}?view=updates`)
    const visualEditor = '[data-test="bearing-update-body-visual-editor"]'
    for (const fixture of fixtures) {
      await page.raw
        .locator('[data-test="bearing-update-body-image-button"]')
        .click()
      await page.raw
        .getByRole('dialog', { name: 'Edit image' })
        .locator('input[type="file"]')
        .setInputFiles({
          name: `${fixture.name}.png`,
          mimeType: 'image/png',
          buffer: fixture.buffer
        })
      await expect(
        page.raw.locator(`${visualEditor} img[src="${fixture.url}"]`)
      ).toHaveCount(1)
      await page.raw.locator(visualEditor).press('ArrowDown')
      await page.raw.locator(visualEditor).press('End')
      await page.raw.locator(visualEditor).press('Enter')
    }
    const screenshotRoot = path.resolve(
      '.tmp/screenshots/issue-638-bearing-images'
    )
    fs.mkdirSync(screenshotRoot, { recursive: true })
    async function checkImages(selector, stage, root = page.raw) {
      for (const fixture of fixtures) {
        await root
          .locator(`${selector} img[src="${fixture.url}"]`)
          .evaluate((image) => image.decode())
      }
      await page.screenshot(path.join(screenshotRoot, `${stage}.png`), {
        fullPage: true,
        animations: 'disabled'
      })
      for (const fixture of fixtures) {
        const size = await root
          .locator(`${selector} img[src="${fixture.url}"]`)
          .evaluate((image) => {
            const rect = image.getBoundingClientRect()
            const parentStyle = getComputedStyle(image.parentElement)
            return {
              width: rect.width,
              height: rect.height,
              naturalWidth: image.naturalWidth,
              naturalHeight: image.naturalHeight,
              available:
                image.parentElement.clientWidth -
                parseFloat(parentStyle.paddingLeft) -
                parseFloat(parentStyle.paddingRight)
            }
          })
        expect(
          Math.abs(size.width / size.height - fixture.width / fixture.height) <
            0.01
        ).toBe(true)
        expect(
          Math.abs(size.width - Math.min(fixture.width, size.available)) < 1
        ).toBe(true)
        expect(size.width <= size.available + 1).toBe(true)
      }
    }
    await checkImages(visualEditor, 'editor-desktop')
    await page.resize(390, 844)
    await checkImages(visualEditor, 'editor-mobile')
    await page.raw
      .locator('#bearing-update-title')
      .fill('Full product screenshots')
    await page.raw
      .locator('#bearing-update-excerpt')
      .fill('The top and bottom remain visible.')
    await page.raw
      .getByRole('button', { name: 'Save draft', exact: true })
      .click()
    await expect(page.raw.locator('#bearing-update-title')).toHaveValue('')
    const draft = await sails.models.bearingupdate.findOne({
      space: space.id,
      title: 'Full product screenshots'
    })
    await page.raw
      .getByRole('button', { name: `Edit draft ${draft.title}` })
      .click()
    await checkImages(visualEditor, 'reopened-mobile')
    await page.raw
      .getByRole('button', { name: 'Publish update', exact: true })
      .click()
    await expect(
      page.raw.getByRole('button', { name: `Edit draft ${draft.title}` })
    ).toHaveCount(0)
    const publicPath = `/_slipway/bearing/host/${project.slug}/${environment.slug}/${app.slug}/updates/p/${draft.slug}`
    await page.raw.route('**/_slipway/bearing/_assets/**', async (route) => {
      const url = new URL(route.request().url())
      url.pathname = url.pathname.replace('/_slipway/bearing/_assets', '')
      await route.continue({ url: url.toString() })
    })
    await page.goto(publicPath)
    await checkImages('.bearing-markdown', 'public-mobile')
    await page.resize(1440, 1000)
    await checkImages('.bearing-markdown', 'public-desktop')
    await page.resize(360, 700)
    const iframeUrl = new URL(
      `${publicPath}?embed=1`,
      page.raw.url()
    ).toString()
    await page.raw.setContent(
      `<iframe title="Product updates" src="${iframeUrl}" style="width:100%;height:680px;border:0"></iframe>`
    )
    await checkImages(
      '.bearing-markdown',
      'public-widget-width',
      page.raw.frameLocator('iframe')
    )
  }
)
