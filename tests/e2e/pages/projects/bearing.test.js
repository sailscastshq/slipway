const fs = require('node:fs')
const path = require('node:path')
const { test } = require('sounding')

test(
  'Bearing settings present identified participation as the calm default',
  {
    browser: true,
    world: {
      name: 'configured-slipway',
      context: {
        deploymentTarget: {
          slug: 'bearing-ui',
          name: 'Bearing UI'
        }
      }
    }
  },
  async ({ sails, world, login, page, expect }) => {
    const current = world.current
    const app = current.apps.web
    const environment = current.environments.production
    const project = current.projects.deploymentTarget
    const screenshotRoot = path.resolve('.tmp/screenshots/issue-398-bearing')
    fs.mkdirSync(screenshotRoot, { recursive: true })

    await sails.models.environment.updateOne({ id: environment.id }).set({
      domain: 'product.example.com',
      features: {
        'sails-hook-slipway': { version: '0.0.7' }
      }
    })
    await sails.models.app
      .updateOne({ id: app.id })
      .set({ bearingEnabled: true })
    const space = await sails.models.bearingspace
      .create({
        publicSlug: 'bearing-operator-ui',
        app: app.id,
        createdBy: current.users.genesisUser.id
      })
      .fetch()
    for (const item of [
      ['Review the new feedback loop', 'reviewing', 7],
      ['Publish a public roadmap', 'planned', 18],
      ['Make voting feel instant', 'in_progress', 12]
    ]) {
      await sails.models.bearingfeedback.create({
        title: item[0],
        status: item[1],
        voteCount: item[2],
        category: 'feature',
        submittedAnonymously: true,
        app: app.id,
        space: space.id
      })
    }
    await sails.models.bearingupdate.create({
      title: 'Bearing is ready for feedback',
      slug: 'bearing-is-ready-for-feedback',
      excerpt: 'The feedback loop now lives on your app domain.',
      body: 'Collect requests, publish direction, and tell customers what shipped.',
      status: 'published',
      publishedAt: Date.now(),
      author: current.users.genesisUser.id,
      app: app.id,
      space: space.id
    })

    await login.withPassword('genesisUser', page, {
      password: current.auth.genesisUserPassword
    })
    const bearingPath = `/projects/${project.slug}/environments/${environment.slug}/apps/${app.slug}/bearing`

    await page.resize(1440, 1000)
    await page.goto(`${bearingPath}?view=settings`)

    await expect(page).toSee('Bearing')
    await expect(page).toSee('Logged-in users only')
    await expect(page).toSee('Recommended')
    await expect(page).toSee('Anyone')
    await expect(page).toSee('Public pages')
    await expect(page).toSee('Feedback categories')
    await expect(page).toSee('Feature')
    await expect(page).toSee('Bug')
    await expect(page).toSee('In-app widget')
    expect(
      await page.raw
        .getByRole('radio', { name: 'Logged-in users only' })
        .isChecked()
    ).toBe(true)
    expect(page).toHaveNoJavascriptErrors()

    await page.screenshot(path.join(screenshotRoot, 'settings-default.png'), {
      fullPage: true
    })
    await page.raw.emulateMedia({ colorScheme: 'dark' })
    await page.screenshot(path.join(screenshotRoot, 'settings-dark.png'), {
      fullPage: true,
      animations: 'disabled'
    })
    await page.raw.emulateMedia({ colorScheme: 'light' })

    await page.resize(390, 844)
    await page.goto(`${bearingPath}?view=settings`)
    await expect(
      page.raw.getByRole('tab', { name: 'Settings' })
    ).toBeInViewport()
    await page.screenshot(path.join(screenshotRoot, 'settings-mobile.png'), {
      fullPage: true
    })
    await page.raw.emulateMedia({ colorScheme: 'dark' })
    await page.screenshot(
      path.join(screenshotRoot, 'settings-mobile-dark.png'),
      {
        fullPage: true,
        animations: 'disabled'
      }
    )
    await page.raw.emulateMedia({ colorScheme: 'light' })

    await page.resize(1440, 1000)
    const tabInertiaRequests = []
    const recordTabInertiaRequest = (request) => {
      const requestUrl = new URL(request.url())
      if (
        requestUrl.pathname === bearingPath &&
        request.headers()['x-inertia']
      ) {
        tabInertiaRequests.push(request.url())
      }
    }
    page.raw.on('request', recordTabInertiaRequest)

    await page.raw.getByRole('tab', { name: 'Overview' }).click()
    await page.raw.waitForFunction(() => window.location.search === '')
    await expect(
      page.raw.getByRole('tabpanel', { name: 'Overview' })
    ).toBeVisible()

    await page.raw.getByRole('tab', { name: 'Feedback' }).click()
    await page.raw.waitForFunction(
      () =>
        new URLSearchParams(window.location.search).get('view') === 'feedback'
    )
    await expect(
      page.raw.getByRole('tab', { name: 'Feedback' })
    ).toHaveAttribute('aria-selected', 'true')

    await page.raw.getByRole('tab', { name: 'Feedback' }).press('ArrowRight')
    await expect(
      page.raw.getByRole('tab', { name: 'Roadmap' })
    ).toHaveAttribute('aria-selected', 'true')
    await page.raw.goBack()
    await expect(
      page.raw.getByRole('tab', { name: 'Feedback' })
    ).toHaveAttribute('aria-selected', 'true')
    expect(tabInertiaRequests).toEqual([])

    for (const view of ['overview', 'feedback', 'roadmap']) {
      const label = view[0].toUpperCase() + view.slice(1)
      const tab = page.raw.getByRole('tab', { name: label })
      await tab.click()
      await expect(tab).toHaveAttribute('aria-selected', 'true')
      await expect(tab).toHaveClass(/bg-gray-900/)
      await expect(
        page.raw.getByRole('tabpanel', { name: label })
      ).toBeVisible()
      await page.screenshot(path.join(screenshotRoot, `operator-${view}.png`), {
        fullPage: true,
        animations: 'disabled'
      })

      if (view === 'overview') {
        await expect(page).toSee('Needs attention')
        await expect(page).toSee('Public surfaces')
        await expect(
          page.raw.locator('[data-test="bearing-metric-feedback"]')
        ).toContainText('3')
        await expect(
          page.raw.locator('[data-test="bearing-public-surface-feedback"]')
        ).toContainText('On')
        await expect(
          page.raw
            .locator('[data-test="bearing-public-surface-feedback"]')
            .getByRole('link', { name: /Open Feedback/ })
        ).toHaveAttribute(
          'href',
          'https://product.example.com/bearing/feedback'
        )

        await page.raw.emulateMedia({ colorScheme: 'dark' })
        await page.raw.waitForTimeout(100)
        await page.screenshot(
          path.join(screenshotRoot, 'operator-overview-dark.png'),
          { fullPage: true, animations: 'disabled' }
        )
        await page.raw.emulateMedia({ colorScheme: 'light' })

        await page.resize(390, 844)
        await expect(
          page.raw.getByRole('tab', { name: 'Overview' })
        ).toBeInViewport()
        await page.screenshot(
          path.join(screenshotRoot, 'operator-overview-mobile.png'),
          { fullPage: true, animations: 'disabled' }
        )
        await page.raw
          .locator('[data-test="bearing-public-surface-updates"]')
          .scrollIntoViewIfNeeded()
        await page.screenshot(
          path.join(
            screenshotRoot,
            'operator-overview-mobile-public-surfaces.png'
          ),
          { animations: 'disabled' }
        )
        await page.resize(1440, 1000)
      } else {
        await page.raw.emulateMedia({ colorScheme: 'dark' })
        await page.screenshot(
          path.join(screenshotRoot, `operator-${view}-dark.png`),
          { fullPage: true, animations: 'disabled' }
        )
        await page.raw.emulateMedia({ colorScheme: 'light' })
        await page.resize(390, 844)
        await expect(tab).toBeInViewport()
        await page.screenshot(
          path.join(screenshotRoot, `operator-${view}-mobile.png`),
          { fullPage: true, animations: 'disabled' }
        )
        await page.resize(1440, 1000)
      }
    }
    page.raw.off('request', recordTabInertiaRequest)

    await sails.models.bearingspace
      .updateOne({ id: space.id })
      .set({ showPublicRoadmap: false })
    await page.goto(`${bearingPath}?view=overview`)
    const disabledRoadmap = page.raw.locator(
      '[data-test="bearing-public-surface-roadmap"]'
    )
    await expect(disabledRoadmap).toContainText('Off')
    await expect(
      disabledRoadmap.getByRole('button', { name: /Turn on Roadmap/ })
    ).toBeVisible()
    await expect(disabledRoadmap.getByRole('link')).toHaveCount(0)

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
    const updateImageDirectory = `bearing/teams/${current.users.genesisUser.team}/projects/${project.id}/apps/${app.id}/updates/assets`
    const updateImageUrl = `https://assets.example.test/${updateImageDirectory}/update-image.png`
    await page.raw.route('**/bearing/updates/images', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ imageUrl: updateImageUrl })
      })
    })

    try {
      await page.goto(`${bearingPath}?view=updates`)
      await page.screenshot(path.join(screenshotRoot, 'operator-updates.png'), {
        fullPage: true
      })
      await page.raw.emulateMedia({ colorScheme: 'dark' })
      await page.screenshot(
        path.join(screenshotRoot, 'operator-updates-dark.png'),
        { fullPage: true, animations: 'disabled' }
      )
      await page.raw.emulateMedia({ colorScheme: 'light' })
      await page.resize(390, 844)
      await expect(
        page.raw.getByRole('tab', { name: 'Updates' })
      ).toBeInViewport()
      await page.screenshot(
        path.join(screenshotRoot, 'operator-updates-mobile.png'),
        { fullPage: true, animations: 'disabled' }
      )
      await page.resize(1440, 1000)

      const updateImage = Buffer.from(
        'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADElEQVR42mNk+M/wHwAF/gL+Xhc4VQAAAABJRU5ErkJggg==',
        'base64'
      )
      await page.raw
        .locator('[data-test="bearing-update-body-image-input"]')
        .setInputFiles({
          name: 'update-image.png',
          mimeType: 'image/png',
          buffer: updateImage
        })

      await expect(
        page.raw.locator('[data-test="bearing-update-body-visual-editor"] img')
      ).toHaveAttribute('src', updateImageUrl, { timeout: 10_000 })
      await expect(page.raw.getByRole('status')).toHaveText('Image added.')
      const updateTitle = page.raw.locator('#bearing-update-title')
      const updateExcerpt = page.raw.locator('#bearing-update-excerpt')
      await updateTitle.fill('Rich updates can carry images')
      await updateExcerpt.fill('Drag, drop, and paste now use Slipway storage.')
      await expect(updateTitle).toHaveValue('Rich updates can carry images')
      await expect(updateExcerpt).toHaveValue(
        'Drag, drop, and paste now use Slipway storage.'
      )
      await page.raw.getByRole('button', { name: 'Save draft' }).click()
      await expect(updateTitle).toHaveValue('')

      const drafted = await sails.models.bearingupdate.findOne({
        title: 'Rich updates can carry images',
        app: app.id
      })
      expect(drafted.body).toContain(updateImageUrl)
    } finally {
      await page.raw.unroute('**/bearing/updates/images')
    }

    await expect(page).toSee('Bearing is ready for feedback')
    expect(page).toHaveNoJavascriptErrors()
  }
)

test(
  'Bearing public feedback feels app-owned before a customer signs in',
  {
    browser: true,
    world: {
      name: 'configured-slipway',
      context: {
        deploymentTarget: {
          slug: 'bearing-public-ui',
          name: 'Northstar'
        }
      }
    }
  },
  async ({ sails, world, page, browserContext, expect }) => {
    const current = world.current
    const app = current.apps.web
    const environment = current.environments.production
    const project = current.projects.deploymentTarget
    const screenshotRoot = path.resolve('.tmp/screenshots/issue-398-bearing')
    fs.mkdirSync(screenshotRoot, { recursive: true })

    await sails.models.user
      .updateOne({ id: current.users.genesisUser.id })
      .set({ fullName: 'Northstar team', initials: 'NT' })
    await sails.models.app.updateOne({ id: app.id }).set({
      bearingEnabled: true
    })
    const space = await sails.models.bearingspace
      .create({
        publicSlug: 'northstar-feedback',
        app: app.id,
        createdBy: current.users.genesisUser.id,
        widgetEnabled: true,
        widgetOpeningView: 'updates',
        showUnread: true,
        feedbackCategories: [
          { key: 'feature', label: 'Feature', active: true },
          { key: 'bug', label: 'Bug', active: true },
          { key: 'docs', label: 'Documentation', active: true },
          {
            key: 'performance',
            label: 'Performance & reliability',
            active: true
          },
          { key: 'integrations', label: 'Integrations', active: true },
          { key: 'billing', label: 'Billing', active: true }
        ]
      })
      .fetch()
    const seededFeedback = [
      {
        publicId: 'bfd_quieter-notifications',
        category: 'feature',
        title: 'Let me choose a calmer notification sound',
        details:
          'A softer option would make notifications useful without breaking focus.',
        voteCount: 27,
        app: app.id,
        space: space.id
      },
      {
        publicId: 'bfd_weekly-digest',
        category: 'bug',
        title: 'A weekly digest for the projects I follow',
        details:
          'One useful summary would be easier to scan than a trail of individual updates.',
        status: 'planned',
        voteCount: 14,
        app: app.id,
        space: space.id
      },
      {
        publicId: 'bfd-keyboard-shortcuts',
        category: 'feature',
        title: 'Keyboard shortcuts for the common actions',
        status: 'in_progress',
        voteCount: 8,
        app: app.id,
        space: space.id
      },
      {
        publicId: 'bfd-faster-search',
        category: 'feature',
        title: 'Search now finds the useful result first',
        details: 'A faster, calmer search shipped this week.',
        status: 'shipped',
        voteCount: 19,
        app: app.id,
        space: space.id
      }
    ]
    for (const feedback of seededFeedback) {
      await sails.models.bearingfeedback.create(feedback)
    }
    await sails.models.bearingupdate.create({
      title: 'Search is faster and calmer',
      slug: 'search-is-faster-and-calmer',
      excerpt: 'Useful results now arrive without the wait.',
      body: 'We rebuilt the slow path and kept the interface focused.\n\n## What changed\n\n- Results arrive sooner\n- The useful match stays at the top\n\nFocused work should stay focused.',
      status: 'published',
      publishedAt: Date.now(),
      author: current.users.genesisUser.id,
      app: app.id,
      space: space.id
    })

    const privateHostBasePath = `/_slipway/bearing/host/${project.slug}/${environment.slug}/${app.slug}`
    const publicPath = `${privateHostBasePath}/feedback`
    await page.raw.route('**/bearing/**', async (route) => {
      const requestUrl = new URL(route.request().url())
      if (
        !requestUrl.pathname.startsWith('/bearing/') ||
        requestUrl.pathname === '/bearing/session'
      ) {
        await route.continue()
        return
      }
      requestUrl.pathname = `${privateHostBasePath}${requestUrl.pathname.slice(
        '/bearing'.length
      )}`
      await route.continue({ url: requestUrl.toString() })
    })
    await page.raw.route('**/_slipway/bearing/_assets/**', async (route) => {
      const assetUrl = new URL(route.request().url())
      assetUrl.pathname = assetUrl.pathname.replace(
        '/_slipway/bearing/_assets',
        ''
      )
      await route.continue({ url: assetUrl.toString() })
    })
    for (const integrationPath of ['bootstrap.js', 'widget-config']) {
      await page.raw.route(
        `**/_slipway/bearing/${integrationPath}*`,
        async (route) => {
          const requestUrl = new URL(route.request().url())
          requestUrl.pathname = `${privateHostBasePath}/${integrationPath}`
          await route.continue({ url: requestUrl.toString() })
        }
      )
    }
    await page.resize(1440, 1000)
    await page.goto(publicPath)
    await page.raw.waitForTimeout(750)
    const appOrigin = new URL(page.raw.url()).origin
    const canonicalUrl = await page.raw
      .locator('link[rel="canonical"]')
      .getAttribute('href')
    const ogUrl = await page.raw
      .locator('meta[property="og:url"]')
      .getAttribute('content')
    const ogImageUrl = await page.raw
      .locator('meta[property="og:image"]')
      .getAttribute('content')
    expect(canonicalUrl).toBe(`${appOrigin}/bearing/feedback`)
    expect(ogUrl).toBe(canonicalUrl)
    expect(ogImageUrl).toBe(`${appOrigin}/bearing/feedback/og.png`)
    expect(
      await page.raw
        .locator('meta[name="twitter:image"]')
        .getAttribute('content')
    ).toBe(ogImageUrl)
    await expect(
      page.raw.getByRole('link', { name: 'Northstar', exact: true })
    ).toHaveAttribute('href', `${appOrigin}/`)
    await expect(page).toSee('Help shape what comes next')
    await expect(page).toSee('Sign in to share')
    await expect(page).toSee('Let me choose a calmer notification sound')
    await expect(page).toSee('A weekly digest for the projects I follow')
    const categoryBadges = page.raw.locator(
      '[data-test="bearing-feedback-category"]'
    )
    await expect(categoryBadges.first()).not.toHaveClass(/shadow/)
    await expect(categoryBadges.first()).not.toHaveClass(/bg-white/)
    expect(
      await page.raw
        .getByRole('link', { name: 'Powered by Slipway' })
        .getAttribute('href')
    ).toBe('https://docs.sailscasts.com/slipway')
    expect(page).toHaveNoJavascriptErrors()

    const feedbackSearch = page.raw.getByRole('searchbox', {
      name: 'Search feedback'
    })
    await expect(feedbackSearch).toHaveClass(/border-dashed/)
    await expect(feedbackSearch).not.toHaveClass(/rounded/)

    const filterButtonBox = await page.raw
      .locator('[data-test="open-mobile-feedback-filters"]')
      .boundingBox()
    const firstFeedbackCardBox = await page.raw
      .locator('.bearing-feedback-card')
      .first()
      .boundingBox()
    expect(
      Math.abs(
        filterButtonBox.x +
          filterButtonBox.width -
          (firstFeedbackCardBox.x + firstFeedbackCardBox.width)
      ) <= 1
    ).toBe(true)

    await page.screenshot(path.join(screenshotRoot, 'feedback-public.png'), {
      fullPage: true
    })
    await page.raw.getByRole('button', { name: /Filter and sort/ }).click()
    await expect(page).toSee('Filter feedback')
    await page.screenshot(
      path.join(screenshotRoot, 'feedback-filters-desktop.png')
    )
    await page.raw.getByRole('button', { name: 'Close filters' }).click()

    await page.resize(390, 844)
    await page.raw.waitForTimeout(250)
    await page.screenshot(
      path.join(screenshotRoot, 'feedback-public-mobile.png'),
      { fullPage: true }
    )
    await page.raw.getByRole('button', { name: /Filter and sort/ }).click()
    await expect(page).toSee('Filter feedback')
    const categoryFilter = page.raw.locator(
      '[data-test="bearing-feedback-category-filter"]'
    )
    await expect(categoryFilter).toHaveClass(/border-dashed/)
    expect(
      await page.raw.locator('input[name="mobile-feedback-category"]').count()
    ).toBe(0)
    await page.screenshot(
      path.join(screenshotRoot, 'feedback-filters-mobile.png')
    )
    await page.raw.emulateMedia({ colorScheme: 'dark' })
    await page.raw.waitForTimeout(250)
    await page.screenshot(
      path.join(screenshotRoot, 'feedback-filters-mobile-dark.png')
    )
    await page.raw.emulateMedia({ colorScheme: 'light' })
    await page.raw.waitForTimeout(250)
    await page.raw.getByRole('button', { name: 'Close filters' }).click()

    await page.resize(1440, 1000)
    await page.goto(`${publicPath}?category=bug&status=planned&sort=newest`)
    await expect(page).toSee('A weekly digest for the projects I follow')
    expect(page.raw.url()).toContain('category=bug')
    expect(page.raw.url()).toContain('status=planned')
    await page.screenshot(path.join(screenshotRoot, 'feedback-filtered.png'), {
      fullPage: true
    })

    await sails.helpers.bearing.ensureAppSecret.with({
      appId: String(app.id),
      rotate: true
    })
    const now = Date.now()
    const participant = await sails.models.bearingparticipant
      .create({
        participantKey: 'generated-by-lifecycle',
        hostUserId: 'northstar-customer',
        displayName: 'Ada Customer',
        email: 'ada@northstar.example.com',
        emailVerifiedAt: now,
        firstSeenAt: now,
        lastSeenAt: now,
        space: space.id
      })
      .fetch()
    const code = await sails.helpers.bearing.issueLaunchCode.with({
      participantId: String(participant.id),
      appId: String(app.id)
    })
    await page.raw.goto(`/bearing/session?code=${encodeURIComponent(code)}`)
    await page.goto(publicPath)
    await expect(page.raw.getByLabel('Posting as Ada Customer')).toBeVisible()
    await expect(page).toSee('Feature')
    await expect(page).toSee('Bug')
    const composer = page.raw.locator('form')
    await composer.getByRole('combobox', { name: 'Category' }).click()
    await page.screenshot(
      path.join(screenshotRoot, 'feedback-form-dropdown.png'),
      { fullPage: true }
    )
    await composer.getByRole('option', { name: 'Bug', exact: true }).click()
    await expect(
      composer.getByPlaceholder('Describe the problem')
    ).toBeVisible()
    await composer.getByRole('combobox', { name: 'Category' }).click()
    await composer.getByRole('option', { name: 'Feature', exact: true }).click()
    const titleField = composer.getByPlaceholder('Describe your idea')
    const detailsField = composer.getByPlaceholder('Add details (optional)')
    await expect(titleField).toBeVisible()
    expect(
      await composer.getByRole('button', { name: 'Share' }).isDisabled()
    ).toBe(true)

    await titleField.click()
    await expectComposerFieldToStayUnboxed(titleField, expect)
    await page.raw.keyboard.press('Tab')
    await expectComposerFieldToStayUnboxed(detailsField, expect)
    await page.screenshot(path.join(screenshotRoot, 'feedback-form.png'), {
      fullPage: true
    })
    await page.resize(390, 844)
    await expectComposerFieldToStayUnboxed(detailsField, expect)
    await page.screenshot(
      path.join(screenshotRoot, 'feedback-form-mobile.png'),
      { fullPage: true }
    )
    await page.raw.emulateMedia({ colorScheme: 'dark' })
    await page.raw.waitForTimeout(250)
    await expectComposerFieldToStayUnboxed(detailsField, expect)
    await page.screenshot(
      path.join(screenshotRoot, 'feedback-form-mobile-dark.png'),
      { fullPage: true }
    )
    await page.resize(1440, 1000)
    await page.screenshot(path.join(screenshotRoot, 'feedback-form-dark.png'), {
      fullPage: true
    })
    await page.raw.emulateMedia({ colorScheme: 'light' })

    await composer.getByRole('combobox', { name: 'Category' }).click()
    await composer.getByRole('option', { name: 'Bug', exact: true }).click()
    await composer
      .getByPlaceholder('Describe the problem')
      .fill('Keep unfinished feedback safe')
    await composer
      .getByPlaceholder('Add details (optional)')
      .fill('This draft should survive an accidental refresh.')
    expect(
      await composer.getByRole('button', { name: 'Share' }).isDisabled()
    ).toBe(false)
    await page.raw.waitForTimeout(600)
    await page.raw.reload()
    await expect(
      composer.getByRole('combobox', { name: 'Category' })
    ).toContainText('Bug')
    await expect(composer.getByPlaceholder('Describe the problem')).toHaveValue(
      'Keep unfinished feedback safe'
    )
    await expect(
      composer.getByPlaceholder('Add details (optional)')
    ).toHaveValue('This draft should survive an accidental refresh.')
    await expect(page).toSee('Draft restored.')
    await composer.getByRole('button', { name: 'Discard' }).click()
    expect(
      await composer.getByRole('button', { name: 'Share' }).isDisabled()
    ).toBe(true)

    const onePixelPng = Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADElEQVR42mNk+M/wHwAF/gL+Xhc4VQAAAABJRU5ErkJggg==',
      'base64'
    )
    const originalStorageConfig = sails.helpers.uploads.getStorageConfig
    const originalImageUpload = sails.helpers.bearing.uploadFeedbackImages
    sails.helpers.uploads.getStorageConfig = helper(async () => ({
      key: 'test-key',
      secret: 'test-secret',
      bucket: 'slipway-test',
      endpoint: 'https://r2.example.test',
      publicUrl: 'https://assets.example.test',
      region: 'auto'
    }))
    sails.helpers.bearing.uploadFeedbackImages = helper(
      async ({ req, fields, directory }) => {
        await Promise.all(
          fields.map(
            (field) =>
              new Promise((resolve, reject) => {
                req.file(field).upload(
                  {
                    maxBytes: 5 * 1024 * 1024,
                    saveAs: (_incoming, proceed) =>
                      proceed(null, `${field}.png`)
                  },
                  (error) => (error ? reject(error) : resolve())
                )
              })
          )
        )
        return fields.map((field) => ({
          url: `data:image/png;base64,${onePixelPng.toString('base64')}`,
          objectPath: `${directory}/${field}.png`,
          name: `${field}.png`,
          size: onePixelPng.length,
          type: 'image/png'
        }))
      }
    )

    try {
      await composer.locator('input[type="file"]').setInputFiles({
        name: 'picked-screenshot.png',
        mimeType: 'image/png',
        buffer: onePixelPng
      })
      await composer.evaluate((element) => {
        const bytes = Uint8Array.from(
          atob(
            'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADElEQVR42mNk+M/wHwAF/gL+Xhc4VQAAAABJRU5ErkJggg=='
          ),
          (character) => character.charCodeAt(0)
        )
        const clipboard = new DataTransfer()
        clipboard.items.add(
          new File([bytes], 'pasted-screenshot.png', { type: 'image/png' })
        )
        element.dispatchEvent(
          new ClipboardEvent('paste', {
            bubbles: true,
            cancelable: true,
            clipboardData: clipboard
          })
        )

        const dragged = new DataTransfer()
        dragged.items.add(
          new File([bytes], 'dropped-screenshot.png', { type: 'image/png' })
        )
        element.dispatchEvent(
          new DragEvent('dragenter', {
            bubbles: true,
            cancelable: true,
            dataTransfer: dragged
          })
        )
        element.dispatchEvent(
          new DragEvent('drop', {
            bubbles: true,
            cancelable: true,
            dataTransfer: dragged
          })
        )
      })
      await expect(composer.locator('figure')).toHaveCount(3)
      await expect(page).toSee('Paste or drop · 3/4')
      await composer
        .getByPlaceholder('Describe your idea')
        .fill('Let feedback include screenshots')
      await composer
        .getByPlaceholder('Add details (optional)')
        .fill('Picker, paste, and drop should all arrive together.')
      await page.screenshot(
        path.join(screenshotRoot, 'feedback-form-images.png'),
        { fullPage: true }
      )
      await composer.getByRole('button', { name: 'Share' }).click()
      const imageFeedback = page.raw
        .locator('.bearing-feedback-card')
        .filter({ hasText: 'Let feedback include screenshots' })
      await expect(imageFeedback).toBeVisible()
      await expect(imageFeedback.locator('img')).toHaveCount(3)
      await page.screenshot(
        path.join(screenshotRoot, 'feedback-images-shared.png'),
        { fullPage: true }
      )
    } finally {
      sails.helpers.uploads.getStorageConfig = originalStorageConfig
      sails.helpers.bearing.uploadFeedbackImages = originalImageUpload
    }

    const streamedFeedback = await sails.models.bearingfeedback
      .create({
        publicId: 'bfd-live-arrival',
        category: 'feature',
        title: 'Live feedback lands without a refresh',
        details: 'The board reconciles, moves, and highlights the new signal.',
        voteCount: 99,
        app: app.id,
        space: space.id
      })
      .fetch()
    await sails.helpers.bearing.broadcastFeedback.with({
      spaceId: String(space.id),
      verb: 'created',
      feedback: {
        publicId: streamedFeedback.publicId,
        title: streamedFeedback.title,
        details: streamedFeedback.details,
        category: streamedFeedback.category,
        status: streamedFeedback.status,
        voteCount: streamedFeedback.voteCount,
        createdAt: streamedFeedback.createdAt,
        updatedAt: streamedFeedback.updatedAt,
        authorName: 'A customer'
      }
    })
    await page.reload()
    const liveCard = page.raw
      .locator('.bearing-feedback-card')
      .filter({ hasText: 'Live feedback lands without a refresh' })
    await expect(liveCard).toBeVisible()
    await page.screenshot(
      path.join(screenshotRoot, 'feedback-live-arrival.png'),
      { fullPage: true }
    )
    await browserContext.grantPermissions(
      ['clipboard-read', 'clipboard-write'],
      { origin: new URL(page.raw.url()).origin }
    )
    await page.raw.evaluate(() => {
      Object.defineProperty(navigator, 'share', {
        configurable: true,
        value: async (value) => {
          window.__bearingSharedUrl = value.url
        }
      })
    })
    const shareButton = page.raw
      .locator(`#bearing-feedback-${streamedFeedback.publicId}`)
      .getByRole('button', {
        name: 'Share Live feedback lands without a refresh'
      })
    await expect(shareButton).toHaveAccessibleName(
      'Share Live feedback lands without a refresh'
    )
    await shareButton.click()
    await page.raw.waitForFunction(() => Boolean(window.__bearingSharedUrl))
    expect(await page.raw.evaluate(() => window.__bearingSharedUrl)).toContain(
      `/feedback/${streamedFeedback.publicId}`
    )

    await page.goto(`${publicPath}/${streamedFeedback.publicId}`)
    const sharedCard = page.raw.locator('[data-shared-focus="true"]')
    await expect(sharedCard).toContainText(
      'Live feedback lands without a refresh'
    )
    await expect(sharedCard).toHaveAttribute('data-live-highlight', 'true')
    await page.screenshot(
      path.join(screenshotRoot, 'feedback-shared-focus.png'),
      { fullPage: true }
    )
    await page.resize(390, 844)
    await page.raw.waitForTimeout(250)
    expect(
      await sharedCard
        .getByRole('button', {
          name: 'Share Live feedback lands without a refresh'
        })
        .evaluate((element) => window.getComputedStyle(element).opacity)
    ).toBe('1')
    await page.screenshot(
      path.join(screenshotRoot, 'feedback-shared-focus-mobile.png'),
      { fullPage: true }
    )
    await page.resize(1440, 1000)

    await page.goto('/bearing/roadmap')
    await expect(page).toSee('Where we are heading')
    await page.screenshot(path.join(screenshotRoot, 'roadmap-public.png'), {
      fullPage: true
    })
    await page.goto('/bearing/updates')
    await expect(page).toSee('What is new')
    await page.screenshot(path.join(screenshotRoot, 'updates-public.png'), {
      fullPage: true
    })
    const updateDetailPath = `/_slipway/bearing/host/${project.slug}/${environment.slug}/${app.slug}/updates/p/search-is-faster-and-calmer`
    const updateDocument = await page.raw.request.get(updateDetailPath)
    expect(updateDocument.status()).toBe(200)
    const updateDocumentHtml = await updateDocument.text()
    expect(updateDocumentHtml).toContain(
      '<title data-inertia="">Search is faster and calmer · Northstar</title>'
    )
    expect(updateDocumentHtml).toContain(
      'property="og:description" content="Useful results now arrive without the wait."'
    )
    expect(updateDocumentHtml).toContain(
      `${appOrigin}/bearing/updates/p/search-is-faster-and-calmer" />`
    )
    await page.goto(updateDetailPath)
    await expect(page).toSee('Search is faster and calmer')
    await expect(page).toSee('What changed')
    await page.screenshot(
      path.join(screenshotRoot, 'update-detail-public.png'),
      { fullPage: true }
    )
    const updateOgResponse = await page.raw.request.get(
      `/_slipway/bearing/host/${project.slug}/${environment.slug}/${app.slug}/updates/p/search-is-faster-and-calmer/og.png`
    )
    expect(updateOgResponse.status()).toBe(200)
    expect(updateOgResponse.headers()['content-type']).toContain('image/png')
    fs.writeFileSync(
      path.join(screenshotRoot, 'update-og.png'),
      await updateOgResponse.body()
    )

    const bootstrapPath = '/_slipway/bearing/bootstrap.js'
    await injectBearingWidget(page, bootstrapPath)
    const widget = page.raw.locator('[data-slipway-bearing-widget]')
    const widgetTrigger = widget.locator('[data-trigger]')
    await expect(widgetTrigger).toContainText('What’s new')
    await expect(widgetTrigger).toHaveAttribute('aria-expanded', 'false')
    await page.screenshot(path.join(screenshotRoot, 'widget-whats-new.png'), {
      fullPage: true
    })
    await widgetTrigger.click()
    const widgetPanel = widget.locator('dialog')
    await expect(widgetPanel).toBeVisible()
    await expect(widgetTrigger).toBeHidden()
    await expect(widgetTrigger).toHaveAttribute('aria-expanded', 'true')
    const widgetBounds = await widgetPanel.boundingBox()
    expect(widgetBounds.x + widgetBounds.width > 1400).toBe(true)
    expect(widgetBounds.y + widgetBounds.height > 900).toBe(true)
    await page.raw.waitForTimeout(220)
    await page.screenshot(path.join(screenshotRoot, 'widget-open.png'), {
      fullPage: true
    })
    await page.resize(390, 844)
    await page.raw.waitForTimeout(220)
    const mobileWidgetBounds = await widgetPanel.boundingBox()
    expect({
      left: Math.round(mobileWidgetBounds.x),
      right: Math.round(mobileWidgetBounds.x + mobileWidgetBounds.width),
      bottom: Math.round(mobileWidgetBounds.y + mobileWidgetBounds.height)
    }).toEqual({ left: 0, right: 390, bottom: 844 })
    await page.screenshot(path.join(screenshotRoot, 'widget-open-mobile.png'))
    await page.resize(1440, 1000)
    await widget.locator('[data-close]').click()
    await expect(widgetPanel).not.toBeVisible()
    await expect(widgetTrigger).toBeHidden()
    await revealLatestUpdateTrigger(page, space.publicSlug)
    await expect(widgetTrigger).toContainText('What’s new')
    await widgetTrigger.click()
    await expect(widgetPanel).toBeVisible()
    await page.raw.keyboard.press('Escape')
    await expect(widgetPanel).not.toBeVisible()
    await expect(widgetTrigger).toBeHidden()
    await revealLatestUpdateTrigger(page, space.publicSlug)
    await widgetTrigger.click()
    await expect(widgetPanel).toBeVisible()
    await page.raw.mouse.click(80, 80)
    await expect(widgetPanel).not.toBeVisible()
    await expect(widgetTrigger).toBeHidden()
    await revealLatestUpdateTrigger(page, space.publicSlug)
    await widgetTrigger.click()
    await expect(widgetPanel).toBeVisible()
    await widget.locator('[data-close]').click()
    await expect(widgetPanel).not.toBeVisible()
    await expect(widgetTrigger).toBeHidden()
    await page.reload()
    await injectBearingWidget(page, bootstrapPath)
    const reloadedWidgetTrigger = page.raw
      .locator('[data-slipway-bearing-widget]')
      .locator('[data-trigger]')
    await expect(reloadedWidgetTrigger).toBeHidden()

    await revealLatestUpdateTrigger(page, space.publicSlug)
    const ordinaryLinkWasIntercepted = await page.raw.evaluate(async () => {
      const link = document.querySelector('a[href="/bearing/feedback"]')
      link.id = 'host-feedback-link'
      return new Promise((resolve) => {
        link.addEventListener(
          'click',
          (event) => {
            resolve(event.defaultPrevented)
            event.preventDefault()
          },
          { once: true }
        )
        link.click()
      })
    })
    expect(ordinaryLinkWasIntercepted).toBe(false)
    await page.raw.evaluate(() => {
      const link = document.querySelector('#host-feedback-link')
      const actions = document.createElement('div')
      actions.id = 'host-bearing-actions'
      for (const [surface, label] of [
        ['feedback', 'Share feedback'],
        ['roadmap', 'Roadmap'],
        ['updates', "What's new"]
      ]) {
        const button = document.createElement('button')
        button.id = `host-${surface}-button`
        button.type = 'button'
        button.className = link.className
        button.dataset.slipwayBearingOpen = surface
        button.textContent = label
        actions.append(button)
      }
      link.replaceWith(actions)
    })
    const hostFeedbackButton = page.raw.locator('#host-feedback-button')
    const hostRoadmapButton = page.raw.locator('#host-roadmap-button')
    const hostUpdatesButton = page.raw.locator('#host-updates-button')
    await hostFeedbackButton.click()
    await expect(widgetPanel).toBeVisible()
    await expect(widgetPanel).toHaveAttribute('data-opened-from', 'host')
    await expect(widgetTrigger).toBeHidden()
    const widgetFrame = widget.locator('iframe')
    await expect(widgetFrame).toHaveAttribute(
      'src',
      '/bearing/feedback?embedded=1'
    )
    expect(
      await page.raw.evaluate(() => ({
        documentElement: document.documentElement.style.overflow,
        body: document.body.style.overflow
      }))
    ).toEqual({ documentElement: 'hidden', body: 'hidden' })
    await expect(
      page.raw
        .frameLocator('[data-slipway-bearing-widget] iframe')
        .getByLabel('Summary')
    ).toBeVisible()
    await page.screenshot(
      path.join(screenshotRoot, 'widget-feedback-from-host.png'),
      { fullPage: true }
    )
    await page.raw.emulateMedia({
      colorScheme: 'dark',
      reducedMotion: 'reduce'
    })
    await expect(widgetPanel).toHaveCSS('animation-name', 'none')
    await page.screenshot(
      path.join(screenshotRoot, 'widget-feedback-from-host-dark.png'),
      { fullPage: true, animations: 'disabled' }
    )
    await page.raw.emulateMedia({
      colorScheme: 'light',
      reducedMotion: 'no-preference'
    })
    await page.raw.waitForTimeout(220)
    await page.resize(390, 844)
    await page.raw.waitForTimeout(220)
    const hostWidgetMobileBounds = await widgetPanel.boundingBox()
    expect({
      left: Math.round(hostWidgetMobileBounds.x),
      right: Math.round(
        hostWidgetMobileBounds.x + hostWidgetMobileBounds.width
      ),
      bottom: Math.round(
        hostWidgetMobileBounds.y + hostWidgetMobileBounds.height
      )
    }).toEqual({ left: 0, right: 390, bottom: 844 })
    await page.screenshot(
      path.join(screenshotRoot, 'widget-feedback-from-host-mobile.png')
    )
    await page.resize(1440, 1000)
    await expect(widget.locator('[data-close]')).toBeFocused()
    await page.raw.keyboard.press('Shift+Tab')
    await expect(widget.locator('.bearing-powered-by')).toBeFocused()
    await page.raw.keyboard.press('Tab')
    await expect(widget.locator('[data-close]')).toBeFocused()
    await widget.locator('[data-close]').click()
    await expect(widgetPanel).not.toBeVisible()
    await expect(hostFeedbackButton).toBeFocused()
    expect(
      await page.raw.evaluate(() => ({
        documentElement: document.documentElement.style.overflow,
        body: document.body.style.overflow
      }))
    ).toEqual({ documentElement: '', body: '' })
    await expect(widgetTrigger).toContainText('What’s new')

    await hostFeedbackButton.click()
    const embeddedSummary = page.raw
      .frameLocator('[data-slipway-bearing-widget] iframe')
      .getByLabel('Summary')
    await embeddedSummary.focus()
    await embeddedSummary.press('Escape')
    await expect(widgetPanel).not.toBeVisible()
    await expect(hostFeedbackButton).toBeFocused()

    await hostRoadmapButton.click()
    await expect(widgetFrame).toHaveAttribute(
      'src',
      '/bearing/roadmap?embedded=1'
    )
    await expect(widget.locator('[data-surface="roadmap"]')).toHaveAttribute(
      'aria-current',
      'page'
    )
    await widget.locator('[data-close]').click()
    await expect(hostRoadmapButton).toBeFocused()

    await hostUpdatesButton.click()
    await expect(widgetFrame).toHaveAttribute(
      'src',
      '/bearing/updates?embedded=1'
    )
    await widget.locator('[data-close]').click()
    await expect(hostUpdatesButton).toBeFocused()
    await expect(widgetTrigger).toBeHidden()

    await page.raw.evaluate(() => {
      window.dispatchEvent(
        new CustomEvent('slipway:bearing:open', {
          detail: { surface: 'feedback' }
        })
      )
    })
    await expect(widgetPanel).toBeVisible()
    await expect(widgetFrame).toHaveAttribute(
      'src',
      '/bearing/feedback?embedded=1'
    )
    await widget.locator('[data-close]').click()

    const infiniteFeedbackStartedAt = Date.now() - 100_000
    for (const infiniteFeedback of Array.from({ length: 25 }, (_, index) => ({
      publicId: `bfd-infinite-${index + 1}`,
      category: 'feature',
      title: `Infinite feedback ${index + 1}`,
      details: 'Loaded as the board approaches the end of the current page.',
      status: 'reviewing',
      voteCount: 0,
      createdAt: infiniteFeedbackStartedAt + index,
      app: app.id,
      space: space.id
    }))) {
      await sails.models.bearingfeedback.create(infiniteFeedback)
    }

    let releaseNextPage
    const nextPageGate = new Promise((resolve) => {
      releaseNextPage = resolve
    })
    const nextPageRequest = page.raw.waitForRequest((request) => {
      const requestUrl = new URL(request.url())
      return (
        requestUrl.searchParams.get('page') === '2' &&
        request.headers()['x-inertia-infinite-scroll-merge-intent'] === 'append'
      )
    })
    await page.raw.route('**/feedback*', async (route) => {
      const requestUrl = new URL(route.request().url())
      if (
        requestUrl.searchParams.get('page') === '2' &&
        route.request().headers()['x-inertia-infinite-scroll-merge-intent'] ===
          'append'
      ) {
        await nextPageGate
      }
      await route.fallback()
    })
    await page.goto(publicPath)
    const feedbackCards = page.raw.locator('.bearing-feedback-card')
    await expect(page).toSee('20 posts shown')
    await expect(feedbackCards).toHaveCount(20)
    const firstPageIds = await feedbackCards.evaluateAll((cards) =>
      cards.map((card) => card.id)
    )
    await feedbackCards.last().scrollIntoViewIfNeeded()
    const appendRequest = await nextPageRequest
    expect(
      appendRequest.headers()['x-inertia-infinite-scroll-merge-intent']
    ).toBe('append')
    releaseNextPage()
    await expect(page.raw.getByText('31 posts shown')).toBeVisible()
    await expect(feedbackCards).toHaveCount(31)
    const loadedIds = await feedbackCards.evaluateAll((cards) =>
      cards.map((card) => card.id)
    )
    const loadedPageTags = await page.raw
      .locator('.bearing-feedback-items > *')
      .evaluateAll((cards) =>
        cards.map((card) => card.dataset.infiniteScrollPage || null)
      )
    expect(
      loadedPageTags.filter((pageNumber) => pageNumber === '1').length
    ).toBe(20)
    expect(
      loadedPageTags.filter((pageNumber) => pageNumber === '2').length
    ).toBe(11)
    expect(
      loadedIds.filter((publicId) => !firstPageIds.includes(publicId)).length
    ).toBe(11)
    const secondPageOnlyId = loadedIds.find(
      (publicId) => !firstPageIds.includes(publicId)
    )
    await page.raw
      .locator('.bearing-feedback-items > [data-infinite-scroll-page="2"]')
      .last()
      .scrollIntoViewIfNeeded()
    const visiblePageTags = await page.raw
      .locator('.bearing-feedback-items > *')
      .evaluateAll((cards) =>
        cards
          .filter((card) => {
            const bounds = card.getBoundingClientRect()
            return bounds.bottom > 0 && bounds.top < window.innerHeight
          })
          .map((card) => card.dataset.infiniteScrollPage || null)
      )
    expect(visiblePageTags.includes('2')).toBe(true)
    await expect(page.raw).toHaveURL(/[?&]page=2(?:&|$)/)
    const shareableViewUrl = page.raw.url()
    expect(page).toHaveNoJavascriptErrors()
    await page.screenshot(
      path.join(screenshotRoot, 'feedback-infinite-scroll.png')
    )

    await page.goto(shareableViewUrl)
    await expect(page.raw.locator(`[id="${secondPageOnlyId}"]`)).toBeVisible()
    await expect(page.raw).toHaveURL(/[?&]page=2(?:&|$)/)
    await page.raw.unroute('**/feedback*')

    const ogResponse = await page.raw.request.get(
      `/_slipway/bearing/host/${project.slug}/${environment.slug}/${app.slug}/feedback/og.png`
    )
    expect(ogResponse.status()).toBe(200)
    expect(ogResponse.headers()['content-type']).toContain('image/png')
    const ogImage = await ogResponse.body()
    await expectSocialImageText(page, ogImage, expect)
    fs.writeFileSync(path.join(screenshotRoot, 'feedback-og.png'), ogImage)
  }
)

async function expectSocialImageText(page, image, expect) {
  const metrics = await page.raw.evaluate(async (source) => {
    const element = new Image()
    element.src = source
    await element.decode()

    const canvas = document.createElement('canvas')
    canvas.width = element.naturalWidth
    canvas.height = element.naturalHeight
    const context = canvas.getContext('2d')
    context.drawImage(element, 0, 0)

    const headline = context.getImageData(88, 220, 900, 56).data
    const platformBadge = context.getImageData(964, 68, 148, 148).data
    let darkPixels = 0
    for (let index = 0; index < headline.length; index += 4) {
      if (
        headline[index] < 80 &&
        headline[index + 1] < 80 &&
        headline[index + 2] < 80 &&
        headline[index + 3] > 0
      ) {
        darkPixels += 1
      }
    }

    let badgePixels = 0
    let slippyPixels = 0
    for (let index = 0; index < platformBadge.length; index += 4) {
      if (
        platformBadge[index] < 50 &&
        platformBadge[index + 1] < 50 &&
        platformBadge[index + 2] < 55 &&
        platformBadge[index + 3] > 0
      ) {
        badgePixels += 1
      }
      if (
        platformBadge[index] < 90 &&
        platformBadge[index + 1] > 140 &&
        platformBadge[index + 2] > 190 &&
        platformBadge[index + 3] > 0
      ) {
        slippyPixels += 1
      }
    }

    return {
      width: element.naturalWidth,
      height: element.naturalHeight,
      darkPixels,
      badgePixels,
      slippyPixels
    }
  }, `data:image/png;base64,${image.toString('base64')}`)

  expect(metrics.width).toBe(1200)
  expect(metrics.height).toBe(630)
  expect(metrics.darkPixels > 500).toBe(true)
  expect(metrics.badgePixels > 10000).toBe(true)
  expect(metrics.slippyPixels > 200).toBe(true)
}

function helper(fn) {
  fn.with = fn
  return fn
}

async function expectComposerFieldToStayUnboxed(locator, expect) {
  await expect(locator).toBeFocused()
  expect(
    await locator.evaluate((element) => {
      const styles = window.getComputedStyle(element)
      return {
        outlineStyle: styles.outlineStyle,
        boxShadow: styles.boxShadow,
        borderTopWidth: styles.borderTopWidth
      }
    })
  ).toEqual({ outlineStyle: 'none', boxShadow: 'none', borderTopWidth: '0px' })
}

async function revealLatestUpdateTrigger(page, spaceSlug) {
  const key = `slipway:bearing:${spaceSlug}:seen-update`
  await page.raw.evaluate((storageKey) => {
    window.localStorage.removeItem(storageKey)
    window.dispatchEvent(
      new StorageEvent('storage', {
        key: storageKey,
        newValue: null
      })
    )
  }, key)
}

async function injectBearingWidget(page, source) {
  await page.raw.evaluate((src) => {
    const script = document.createElement('script')
    script.async = true
    script.dataset.slipwayBearing = ''
    script.src = src
    document.body.append(script)
  }, source)
  await page.raw
    .locator('[data-slipway-bearing-widget]')
    .waitFor({ state: 'attached' })
}
