const { test } = require('sounding')

test(
  'Bearing recovers unsaved updates and preserves edits made during repeated saves',
  {
    browser: true,
    world: {
      name: 'configured-slipway',
      context: {
        deploymentTarget: {
          slug: 'bearing-update-recovery',
          name: 'Bearing Update Recovery'
        }
      }
    }
  },
  async ({ sails, world, login, page, expect }) => {
    const current = world.current
    const app = current.apps.web
    const project = current.projects.deploymentTarget
    const environment = current.environments.production
    const space = await sails.models.bearingspace
      .create({
        publicSlug: 'bearing-update-recovery',
        app: app.id,
        createdBy: current.users.genesisUser.id
      })
      .fetch()
    const feedback = await sails.models.bearingfeedback
      .create({
        title: 'Keep invoices safe',
        category: 'bug',
        app: app.id,
        space: space.id
      })
      .fetch()
    await login.withPassword('genesisUser', page, {
      password: current.auth.genesisUserPassword
    })
    const bearingPath = `/projects/${project.slug}/environments/${environment.slug}/apps/${app.slug}/bearing`
    await page.goto(`${bearingPath}?view=updates`)
    const title = page.raw.locator('#bearing-update-title')
    const summary = page.raw.locator('#bearing-update-excerpt')
    const body = page.raw.locator(
      '[data-test="bearing-update-body-visual-editor"]'
    )
    await title.fill('A reverted title')
    await page.raw.waitForFunction(() =>
      Object.keys(sessionStorage).some((key) =>
        key.startsWith('slipway:bearing-update-draft:[')
      )
    )
    await title.fill('')
    await page.raw.waitForFunction(
      () =>
        !Object.keys(sessionStorage).some((key) =>
          key.startsWith('slipway:bearing-update-draft:[')
        )
    )
    await title.fill('Unsaved invoice update')
    await summary.fill('A useful summary')
    await body.fill('Useful unsaved details.')
    await page.raw.locator('label').filter({ hasText: feedback.title }).click()
    page.raw.on('dialog', (dialog) => dialog.accept())
    await page.raw.reload()
    await expect(
      page.raw.getByRole('button', { name: 'Restore update', exact: true })
    ).toBeVisible()
    const recoveryKey = await page.raw.evaluate(() =>
      Object.keys(sessionStorage).find((key) =>
        key.startsWith('slipway:bearing-update-draft:[')
      )
    )
    await page.raw
      .getByRole('button', { name: 'Restore update', exact: true })
      .click()
    await expect(title).toHaveValue('Unsaved invoice update')
    await expect(summary).toHaveValue('A useful summary')
    await expect(body).toContainText('Useful unsaved details.')
    await expect(page.raw.getByLabel(feedback.title)).toBeChecked()

    await page.raw
      .getByRole('link', { name: 'Projects', exact: true })
      .first()
      .click()
    const dialog = page.raw.getByRole('dialog', { name: 'Unsaved changes' })
    await expect(dialog).toBeVisible()
    await dialog
      .getByRole('button', { name: 'Keep editing', exact: true })
      .click()
    await expect(title).toHaveValue('Unsaved invoice update')

    await page.raw.setViewportSize({ width: 375, height: 812 })
    let release, arrived
    let requestCount = 0
    const gate = new Promise((resolve) => {
      release = resolve
    })
    const requested = new Promise((resolve) => {
      arrived = resolve
    })
    await page.raw.route(`**${bearingPath}/updates`, async (route) => {
      if (route.request().method() !== 'POST') return route.continue()
      requestCount++
      arrived()
      await gate
      await route.continue()
    })
    try {
      await page.raw
        .getByRole('button', { name: 'Save draft', exact: true })
        .click()
      await requested
      await title.fill('Newer invoice title')
      await summary.fill('Newer summary')
      await body.fill('Newer explanation while saving.')
      await expect(
        page.raw.getByRole('button', { name: 'Save draft', exact: true })
      ).toBeDisabled()
      release()
      await expect(
        page.raw.getByText('Draft saved. Your newer edits are still unsaved.', {
          exact: true
        })
      ).toBeVisible()
      await expect(title).toHaveValue('Newer invoice title')
      expect(requestCount).toBe(1)
      const submitted = await sails.models.bearingupdate.findOne({
        space: space.id
      })
      expect(submitted.title).toBe('Unsaved invoice update')
      await page.raw.reload()
      await page.raw
        .getByRole('button', { name: 'Restore update', exact: true })
        .click()
      await expect(title).toHaveValue('Newer invoice title')
      await expect(
        page.raw.getByRole('button', { name: 'Save changes', exact: true })
      ).toBeVisible()
      await page.raw
        .getByRole('button', { name: 'New update', exact: true })
        .click()
      await dialog
        .getByRole('button', { name: 'Keep editing', exact: true })
        .click()
      await expect(title).toHaveValue('Newer invoice title')
      await title.press('Tab')
      await page.raw
        .getByRole('button', { name: 'Save changes', exact: true })
        .click()
      await expect(title).toHaveValue('')
      expect(await sails.models.bearingupdate.count({ space: space.id })).toBe(
        1
      )
      const saved = await sails.models.bearingupdate.findOne({
        id: submitted.id
      })
      expect(saved.title).toBe('Newer invoice title')
      expect(saved.excerpt).toBe('Newer summary')
      expect(saved.body).toContain('Newer explanation while saving.')
      await page.raw.reload()
      await expect(
        page.raw.getByRole('button', { name: 'Restore update', exact: true })
      ).toHaveCount(0)
    } finally {
      release()
    }

    await page.raw
      .getByRole('button', { name: `Edit draft Newer invoice title` })
      .click()
    await title.fill('Submitted publish title')
    let releasePublish, publishArrived
    const publishGate = new Promise((resolve) => {
      releasePublish = resolve
    })
    const publishRequested = new Promise((resolve) => {
      publishArrived = resolve
    })
    const draftPath = `${bearingPath}/updates/${
      (await sails.models.bearingupdate.findOne({ space: space.id })).publicId
    }`
    await page.raw.route(`**${draftPath}`, async (route) => {
      publishArrived()
      await publishGate
      await route.continue()
    })
    try {
      await title.press('Tab')
      await page.raw
        .getByRole('button', { name: 'Publish update', exact: true })
        .click()
      await publishRequested
      await title.fill('A follow-up after publishing')
      releasePublish()
      await expect(
        page.raw.getByText(
          'Update published. Your newer edits are kept here as a new update.',
          { exact: true }
        )
      ).toBeVisible()
      await expect(title).toHaveValue('A follow-up after publishing')
      expect(
        await sails.models.bearingupdate.count({
          space: space.id,
          status: 'published'
        })
      ).toBe(1)
      await page.raw.reload()
      await page.raw
        .getByRole('button', { name: 'Restore update', exact: true })
        .click()
      await expect(title).toHaveValue('A follow-up after publishing')
      await expect(
        page.raw.getByRole('button', { name: 'Save draft', exact: true })
      ).toBeVisible()
    } finally {
      releasePublish()
    }
    await page.raw.unroute(`**${bearingPath}/updates`)
    await page.raw.route(`**${bearingPath}/updates`, (route) => {
      const data = route.request().postDataJSON()
      return route.continue({
        headers: {
          ...route.request().headers(),
          'content-type': 'application/json'
        },
        postData: JSON.stringify({
          ...data,
          feedbackIds: ['bfd_not_available']
        })
      })
    })
    await page.raw
      .getByRole('button', { name: 'Save draft', exact: true })
      .click()
    await expect(
      page.raw
        .getByRole('alert')
        .filter({ hasText: 'Choose feedback from this Bearing space' })
    ).toBeVisible()
    await expect(title).toHaveValue('A follow-up after publishing')
    expect(await sails.models.bearingupdate.count({ space: space.id })).toBe(1)
    await page.raw.unroute(`**${bearingPath}/updates`)
    await page.raw.setViewportSize({ width: 1440, height: 900 })
    await title.fill('Discarded update')
    await page.raw
      .getByRole('link', { name: 'Projects', exact: true })
      .first()
      .click()
    await dialog
      .getByRole('button', { name: 'Discard and continue', exact: true })
      .click()
    await expect(page.raw).toHaveURL(/\/$/)
    await page.goto(`${bearingPath}?view=updates`)
    await expect(title).toHaveValue('')
    await expect(
      page.raw.getByRole('button', { name: 'Restore update', exact: true })
    ).toHaveCount(0)

    await page.raw.evaluate(() => {
      const key = Object.keys(sessionStorage).find((key) =>
        key.startsWith('slipway:bearing-update-draft:')
      )
      if (key) throw new Error('Discard left recovery behind')
      const user = window.location.pathname
      sessionStorage.setItem(
        'slipway:bearing-update-draft:another-user',
        JSON.stringify({ expiresAt: Date.now() + 60000, data: { title: user } })
      )
    })
    await page.raw.reload()
    await expect(
      page.raw.getByRole('button', { name: 'Restore update', exact: true })
    ).toHaveCount(0)
    await page.raw.evaluate((key) => {
      sessionStorage.setItem(
        key,
        JSON.stringify({
          data: {
            title: 'Expired',
            excerpt: 'Expired',
            body: 'Expired',
            feedbackIds: []
          },
          editingDraft: null,
          savedSnapshot: '{}',
          expiresAt: 0
        })
      )
    }, recoveryKey)
    await page.raw.reload()
    await expect(
      page.raw.getByRole('button', { name: 'Restore update', exact: true })
    ).toHaveCount(0)
    expect(
      await page.raw.evaluate((key) => sessionStorage.getItem(key), recoveryKey)
    ).toBe(null)
    await page.raw.evaluate(() => {
      Storage.prototype.setItem = () => {
        throw new Error('Storage unavailable')
      }
    })
    await title.fill('Still editable without recovery')
    await expect(
      page.raw
        .getByRole('alert')
        .filter({ hasText: 'Draft recovery is unavailable' })
    ).toBeVisible()
    await expect(title).toHaveValue('Still editable without recovery')
  }
)
