const fs = require('node:fs')
const path = require('node:path')
const { test } = require('sounding')
const previewImageUrl = 'https://assets.example.test/bearing/preview.svg'
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
        contentType: 'image/svg+xml',
        body: previewImage
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
    expect(page).toHaveNoJavascriptErrors()
  }
)
