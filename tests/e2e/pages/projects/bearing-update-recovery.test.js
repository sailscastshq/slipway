const fs = require('node:fs')
const path = require('node:path')
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

test(
  'Bearing failed saves retain edits through retries and an asset version change',
  {
    browser: true,
    world: {
      name: 'configured-slipway',
      context: {
        deploymentTarget: {
          slug: 'bearing-save-failures',
          name: 'Bearing Save Failures'
        }
      }
    }
  },
  async ({ sails, world, login, page, expect }) => {
    const current = world.current
    const app = current.apps.web
    const project = current.projects.deploymentTarget
    const environment = current.environments.production
    const author = current.users.genesisUser
    const space = await sails.models.bearingspace
      .create({
        publicSlug: 'bearing-save-failures',
        app: app.id,
        createdBy: author.id
      })
      .fetch()
    const feedback = await sails.models.bearingfeedback
      .create({
        title: 'Keep invoice screenshots',
        category: 'bug',
        app: app.id,
        space: space.id
      })
      .fetch()
    const imageUrl = 'https://assets.example.test/bearing/save-probe.svg'
    const draft = await sails.models.bearingupdate
      .create({
        title: 'Original invoice update',
        slug: 'original-invoice-update',
        excerpt: 'Original invoice summary',
        body: `Useful invoice details.\n\n![Invoice screenshot](${imageUrl} "Invoice caption")`,
        status: 'draft',
        author: author.id,
        app: app.id,
        space: space.id
      })
      .fetch()
    await sails.models.bearingupdatelink.create({
      linkKey: 'bearing-save-failures-link',
      update: draft.id,
      feedback: feedback.id,
      space: space.id
    })
    await login.withPassword('genesisUser', page, {
      password: current.auth.genesisUserPassword
    })
    // The password helper returns after clicking; wait for its redirect before
    // changing the asset version or beginning a competing document navigation.
    await expect(page.raw).toHaveURL(/\/$/)
    await expect(
      page.raw.getByRole('link', { name: project.name, exact: true })
    ).toBeVisible()
    await page.raw.route(imageUrl, (route) =>
      route.fulfill({
        contentType: 'image/svg+xml',
        body: '<svg xmlns="http://www.w3.org/2000/svg" width="320" height="200"><rect width="320" height="200" fill="blue"/></svg>'
      })
    )
    const bearingPath = `/projects/${project.slug}/environments/${environment.slug}/apps/${app.slug}/bearing`
    const composer = `${bearingPath}?view=updates`
    const draftPath = `${bearingPath}/updates/${draft.publicId}`
    const originalVersion = sails.config.inertia.version
    const originalUpdateOne = sails.models.bearingupdate.updateOne
    const trace = []
    const artifacts = path.resolve('.tmp/screenshots/issue-642-save-errors')
    fs.mkdirSync(artifacts, { recursive: true })
    const relevant = (url) =>
      [bearingPath, draftPath].includes(new URL(url).pathname)
    const captureRequest = (request) => {
      if (!relevant(request.url())) return
      const data = request.method() === 'PATCH' ? request.postDataJSON() : null
      trace.push({
        type: 'request',
        method: request.method(),
        url: new URL(request.url()).pathname + new URL(request.url()).search,
        version: request.headers()['x-inertia-version'],
        ...(data
          ? {
              data: {
                title: data.title,
                excerpt: data.excerpt,
                body: data.body,
                feedbackIds: data.feedbackIds
              }
            }
          : {})
      })
    }
    const captureResponse = (response) => {
      if (!relevant(response.url())) return
      trace.push({
        type: 'response',
        method: response.request().method(),
        status: response.status(),
        location: response.headers()['location'],
        inertiaLocation: response.headers()['x-inertia-location']
      })
    }
    const acceptReload = (dialog) => dialog.accept()
    page.raw.on('request', captureRequest)
    page.raw.on('response', captureResponse)
    page.raw.on('dialog', acceptReload)
    let release
    try {
      sails.config.inertia.version = 'bearing-save-before'
      await page.goto(composer)
      await page.raw
        .getByRole('button', { name: `Edit draft ${draft.title}` })
        .click()
      const title = page.raw.locator('#bearing-update-title')
      const summary = page.raw.locator('#bearing-update-excerpt')
      const body = page.raw.locator(
        '[data-test="bearing-update-body-visual-editor"]'
      )
      const save = page.raw.getByRole('button', {
        name: 'Save changes',
        exact: true
      })
      await title.fill('Submitted invoice update')
      await summary.fill('Submitted invoice summary')

      sails.models.bearingupdate.updateOne = () => {
        throw new Error('Private simulated save failure')
      }
      const failedResponse = page.raw.waitForResponse(
        (response) =>
          new URL(response.url()).pathname === draftPath &&
          response.request().method() === 'PATCH'
      )
      await save.click()
      expect((await failedResponse).status()).toBe(500)
      await expect(
        page.raw
          .getByRole('alert')
          .filter({ hasText: 'The save could not be confirmed (500).' })
      ).toBeVisible()
      await expect(page.raw.getByRole('alert')).not.toContainText(
        'Private simulated save failure'
      )
      expect(
        new URL(page.raw.url()).pathname + new URL(page.raw.url()).search
      ).toBe(composer)
      await expect(title).toHaveValue('Submitted invoice update')
      await expect(summary).toHaveValue('Submitted invoice summary')
      await expect(body).toContainText('Useful invoice details.')
      await expect(body.locator('img')).toHaveAttribute(
        'alt',
        'Invoice screenshot'
      )
      await expect(body.locator('img')).toHaveAttribute(
        'title',
        'Invoice caption'
      )
      await expect(page.raw.getByLabel(feedback.title)).toBeChecked()
      await expect(save).toBeEnabled()
      expect(
        (await sails.models.bearingupdate.findOne({ id: draft.id })).title
      ).toBe(draft.title)
      const recovery = await page.raw.evaluate(() => {
        const key = Object.keys(sessionStorage).find((key) =>
          key.startsWith('slipway:bearing-update-draft:[')
        )
        return JSON.parse(sessionStorage.getItem(key))
      })
      expect(recovery.data.title).toBe('Submitted invoice update')
      expect(recovery.editingDraft).toBe(draft.publicId)
      await page.screenshot(
        path.join(artifacts, 'failed-save-preserves-composer.png'),
        { fullPage: true }
      )
      sails.models.bearingupdate.updateOne = originalUpdateOne

      const abortSave = (route) => route.abort('failed')
      await page.raw.route(`**${draftPath}`, abortSave)
      await save.click()
      await expect(
        page.raw.getByRole('alert').filter({
          hasText:
            'The connection was interrupted before the save was confirmed.'
        })
      ).toBeVisible()
      await expect(title).toHaveValue('Submitted invoice update')
      await expect(save).toBeEnabled()
      await page.raw.unroute(`**${draftPath}`, abortSave)

      let arrived
      const requested = new Promise((resolve) => {
        arrived = resolve
      })
      const gate = new Promise((resolve) => {
        release = resolve
      })
      const delaySave = async (route) => {
        arrived()
        await gate
        await route.continue()
      }
      await page.raw.route(`**${draftPath}`, delaySave)
      await save.click()
      await requested
      await title.fill('Newer invoice update')
      await summary.fill('Newer invoice summary')
      sails.config.inertia.version = 'bearing-save-after'
      release()
      await expect(
        page.raw.getByRole('button', { name: 'Restore update', exact: true })
      ).toBeVisible()
      expect(
        new URL(page.raw.url()).pathname + new URL(page.raw.url()).search
      ).toBe(composer)
      await page.raw.unroute(`**${draftPath}`, delaySave)
      const submitted = await sails.models.bearingupdate.findOne({
        id: draft.id
      })
      expect(submitted.title).toBe('Submitted invoice update')
      expect(submitted.excerpt).toBe('Submitted invoice summary')
      expect(submitted.body).toContain(imageUrl)
      expect(submitted.body).toContain('Invoice screenshot')
      expect(submitted.body).toContain('Invoice caption')
      expect(
        await sails.models.bearingupdatelink.count({
          update: draft.id,
          feedback: feedback.id
        })
      ).toBe(1)
      expect(
        trace.some(
          (event) =>
            event.type === 'response' &&
            event.method === 'PATCH' &&
            event.status === 303 &&
            event.location === composer
        )
      ).toBe(true)
      expect(
        trace.some(
          (event) =>
            event.type === 'response' &&
            event.method === 'GET' &&
            event.status === 409 &&
            event.inertiaLocation === composer
        )
      ).toBe(true)
      expect(
        trace.some(
          (event) =>
            event.type === 'request' &&
            event.method === 'GET' &&
            event.url === draftPath
        )
      ).toBe(false)
      await page.raw
        .getByRole('button', { name: 'Restore update', exact: true })
        .click()
      await expect(title).toHaveValue('Newer invoice update')
      await expect(summary).toHaveValue('Newer invoice summary')
      await expect(body.locator('img')).toHaveAttribute(
        'title',
        'Invoice caption'
      )
      await expect(page.raw.getByLabel(feedback.title)).toBeChecked()
      await save.click()
      await expect(title).toHaveValue('')
      const saved = await sails.models.bearingupdate.findOne({ id: draft.id })
      expect(saved.title).toBe('Newer invoice update')
      expect(saved.excerpt).toBe('Newer invoice summary')
      expect(saved.body).toBe(submitted.body)
      expect(await sails.models.bearingupdate.count({ space: space.id })).toBe(
        1
      )
      await page.raw.reload()
      await expect(
        page.raw.getByRole('button', { name: 'Restore update', exact: true })
      ).toHaveCount(0)
      expect(page).toHaveNoJavascriptErrors()
    } finally {
      release?.()
      sails.models.bearingupdate.updateOne = originalUpdateOne
      sails.config.inertia.version = originalVersion
      page.raw.off('request', captureRequest)
      page.raw.off('response', captureResponse)
      page.raw.off('dialog', acceptReload)
      fs.writeFileSync(
        path.join(artifacts, 'save-request-trace.json'),
        JSON.stringify(trace, null, 2)
      )
    }
  }
)
