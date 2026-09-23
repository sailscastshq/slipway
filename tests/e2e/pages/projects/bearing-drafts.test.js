const { test } = require('sounding')

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
        body: 'The invoice list keeps its place.',
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
    ).toContainText(draft.body)
    await expect(page.raw.getByLabel(feedback.title)).toBeChecked()

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
    await page.raw.getByRole('button', { name: 'Delete draft' }).click()
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
