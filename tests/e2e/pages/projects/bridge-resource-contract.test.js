const fs = require('fs')
const path = require('path')

const { test } = require('sounding')

test(
  'Bridge renders the target app resource contract in the existing Slipway UI',
  {
    browser: true,
    world: {
      name: 'configured-slipway',
      context: {
        deploymentTarget: {
          slug: 'bridge-contract-ui',
          name: 'Bridge Contract UI'
        }
      }
    }
  },
  async ({ sails, world, login, page, expect }) => {
    const current = world.current
    const app = current.apps.web
    const environment = current.environments.production
    const project = current.projects.deploymentTarget
    const originalIntrospectModels = sails.helpers.bridge.introspectModels
    const originalBuildSailsWrapper = sails.helpers.bridge.buildSailsWrapper
    const originalExecuteInContainer = sails.helpers.bridge.executeInContainer
    const screenshotRoot = path.resolve(
      '.tmp/screenshots/issue-216-resource-contract'
    )
    const identifierScreenshotRoot = path.resolve(
      '.tmp/screenshots/issue-217-uuid-identifiers'
    )
    const authorizationScreenshotRoot = path.resolve(
      '.tmp/screenshots/issue-218-bridge-authorization'
    )
    const fieldEngineScreenshotRoot = path.resolve(
      '.tmp/screenshots/issue-219-bridge-field-engine'
    )
    const relationshipScreenshotRoot = path.resolve(
      '.tmp/screenshots/issue-220-bridge-relationships'
    )
    const actionScreenshotRoot = path.resolve(
      '.tmp/screenshots/issue-221-bridge-actions'
    )
    const filterScreenshotRoot = path.resolve(
      '.tmp/screenshots/issue-224-bridge-filters'
    )
    const sailscastsScreenshotRoot = path.resolve(
      '.tmp/screenshots/issue-225-sailscasts-bridge-parity'
    )
    const precognitionScreenshotRoot = path.resolve(
      '.tmp/screenshots/issue-208-precognition'
    )

    fs.mkdirSync(screenshotRoot, { recursive: true })
    fs.mkdirSync(identifierScreenshotRoot, { recursive: true })
    fs.mkdirSync(authorizationScreenshotRoot, { recursive: true })
    fs.mkdirSync(fieldEngineScreenshotRoot, { recursive: true })
    fs.mkdirSync(relationshipScreenshotRoot, { recursive: true })
    fs.mkdirSync(actionScreenshotRoot, { recursive: true })
    fs.mkdirSync(filterScreenshotRoot, { recursive: true })
    fs.mkdirSync(sailscastsScreenshotRoot, { recursive: true })
    fs.mkdirSync(precognitionScreenshotRoot, { recursive: true })

    const contract = await sails.helpers.bridge.normalizeResourceContract.with({
      models: resourceMetadata(),
      config: resourceConfig()
    })
    const courseRecordId = '018f2a5c-7b34-7f8a-9c12-4a73b9d80211'
    const createdCourseRecordId = '018f2a5c-7b34-7f8a-9c12-4a73b9d80212'
    const creatorId = '018f2a5c-7b34-7f8a-9c12-4a73b9d80213'
    const chapterId = '018f2a5c-7b34-7f8a-9c12-4a73b9d80214'
    const lessonId = '018f2a5c-7b34-7f8a-9c12-4a73b9d80215'
    const otherCourseId = '018f2a5c-7b34-7f8a-9c12-4a73b9d80217'
    const otherChapterId = '018f2a5c-7b34-7f8a-9c12-4a73b9d80218'
    const records = [
      {
        id: courseRecordId,
        title: 'Build a production Sails app',
        price: 3499,
        published: true,
        createdAt: Date.UTC(2026, 6, 21, 9, 30)
      },
      {
        id: '018f2a5c-7b34-7f8a-9c12-4a73b9d80210',
        title: 'Own the deployment path',
        price: 2900,
        published: true,
        createdAt: Date.UTC(2026, 6, 18, 15, 10)
      },
      {
        id: '018f2a5c-7b34-7f8a-9c12-4a73b9d8020f',
        title: 'A legible cloud on one server',
        price: 1900,
        published: false,
        createdAt: Date.UTC(2026, 6, 12, 11, 5)
      }
    ]
    const record = {
      id: courseRecordId,
      title: 'Build a production Sails app',
      description:
        'A practical path from a Waterline model to a calm production release.',
      thumbnailUrl: 'https://cdn.example.com/courses/production-sails.webp',
      price: 3499,
      website: 'https://sailsjs.com',
      metadata: {
        level: 'production',
        lessons: 12
      },
      published: true,
      creator: creatorId
    }
    let persistedCourseRecord = record
    let createdValues
    let updatedValues
    let inlineUploadRequestBody = ''
    const resourceQueries = []

    await sails.models.app
      .updateOne({ id: app.id })
      .set({ status: 'running', containerName: 'bridge-contract-ui-web' })

    sails.helpers.bridge.introspectModels = async () => ({
      schemaVersion: contract.schemaVersion,
      discover: contract.discover,
      configured: contract.configured,
      models: contract.resources
    })
    sails.helpers.bridge.buildSailsWrapper = async (code) => code
    sails.helpers.bridge.executeInContainer = async (containerName, code) => {
      expect(containerName).toBe('bridge-contract-ui-web')

      if (code.includes('const decisions = Object.create(null);')) {
        const requests = readEmbeddedValue(code, 'requests')
        const decisions = {}
        for (const request of requests) {
          decisions[request.key] = decisions[request.key] || {}
          decisions[request.key][request.action] = [
            'viewAny',
            'view',
            'create'
          ].includes(request.action)
        }
        return successfulResult(decisions)
      }
      if (code.includes('const counts = {};')) {
        return successfulResult({
          course: records.length,
          user: 1
        })
      }
      if (code.includes('const options = {};')) {
        const definitions = readEmbeddedValue(code, 'definitions')
        if (definitions.some((definition) => definition.alias === 'chapter')) {
          return successfulResult({
            course: [
              { id: courseRecordId, label: 'Build a production Sails app' },
              { id: otherCourseId, label: 'Durable UI' }
            ],
            chapter: [],
            creator: [{ id: creatorId, label: 'Ada Lovelace' }]
          })
        }
        return successfulResult({
          creator: [{ id: creatorId, label: 'Ada Lovelace' }]
        })
      }
      if (code.includes('const missing = [];')) {
        return successfulResult({ missing: [] })
      }
      if (code.includes('const fieldErrors = {};')) {
        const values = readEmbeddedValue(code, 'values')
        return successfulResult({
          fieldErrors:
            values.title === 'Existing course'
              ? { title: 'Course title is already in use.' }
              : {}
        })
      }
      if (code.includes('const textSearch = definition.query')) {
        const definition = readEmbeddedValue(code, 'definition')
        if (definition.identity === 'user') {
          expect(definition.where).toEqual({ role: 'admin' })
          return successfulResult({
            options: [
              {
                id: creatorId,
                label: 'Ada Lovelace',
                attached: false
              }
            ],
            page: definition.page,
            limit: definition.limit,
            hasMore: false
          })
        }
        if (definition.identity === 'course') {
          return successfulResult({
            options: [
              { id: courseRecordId, label: 'Build a production Sails app' },
              { id: otherCourseId, label: 'Durable UI' }
            ],
            page: definition.page,
            limit: definition.limit,
            hasMore: false
          })
        }
        if (definition.identity === 'chapter') {
          const scopedToOtherCourse = definition.where.course === otherCourseId
          return successfulResult({
            options: [
              {
                id: scopedToOtherCourse ? otherChapterId : chapterId,
                label: scopedToOtherCourse
                  ? 'Durable form state'
                  : 'The deployment path'
              }
            ],
            page: definition.page,
            limit: definition.limit,
            hasMore: false
          })
        }
        return successfulResult({
          options: [
            {
              id: lessonId,
              label: 'Deploy with confidence',
              attached: true
            },
            {
              id: '018f2a5c-7b34-7f8a-9c12-4a73b9d80216',
              label: 'Operate the boring path',
              attached: false
            }
          ],
          page: definition.page,
          limit: definition.limit,
          hasMore: false
        })
      }
      if (
        code.includes('const parentIdentity =') &&
        code.includes('function present')
      ) {
        return successfulResult({
          creator: {
            alias: 'creator',
            type: 'model',
            label: 'Creator',
            identity: 'user',
            primaryKey: 'id',
            title: 'fullName',
            fields: ['id', 'fullName'],
            limit: 20,
            canAttach: false,
            canDetach: false,
            record: {
              id: creatorId,
              label: 'Ada Lovelace',
              values: {
                id: creatorId,
                fullName: 'Ada Lovelace'
              }
            }
          },
          chapters: {
            alias: 'chapters',
            type: 'collection',
            label: 'Chapters',
            identity: 'chapter',
            primaryKey: 'id',
            title: 'title',
            fields: ['id', 'title'],
            limit: 5,
            canAttach: false,
            canDetach: false,
            records: [
              {
                id: chapterId,
                label: 'The deployment path',
                values: {
                  id: chapterId,
                  title: 'The deployment path'
                }
              }
            ],
            hasMore: false
          },
          lessons: {
            alias: 'lessons',
            type: 'collection',
            label: 'Lessons',
            identity: 'lesson',
            primaryKey: 'id',
            title: 'title',
            fields: ['id', 'title'],
            limit: 5,
            canAttach: true,
            canDetach: true,
            records: [
              {
                id: lessonId,
                label: 'Deploy with confidence',
                values: {
                  id: lessonId,
                  title: 'Deploy with confidence'
                }
              }
            ],
            hasMore: false
          }
        })
      }
      if (code.includes('const total = await model.count(where);')) {
        resourceQueries.push({
          where: readEmbeddedValue(code, 'where'),
          criteria: readEmbeddedValue(code, 'criteria')
        })
        return successfulResult({
          records,
          total: records.length
        })
      }
      if (code.includes('await model.create(values).fetch();')) {
        const submittedValues = readEmbeddedValue(code, 'submittedValues')
        const createResource = readEmbeddedValue(code, 'resource')
        expect(createResource.attributes.id.field.default).toEqual({
          helper: 'getUuid'
        })
        createdValues = {
          id: createdCourseRecordId,
          ...submittedValues
        }
        persistedCourseRecord = {
          ...createdValues,
          price: submittedValues.price * 100
        }
        return successfulResult({ record: persistedCourseRecord })
      }
      if (code.includes('await model.updateOne(criteria).set(values);')) {
        updatedValues = readEmbeddedValue(code, 'values')
        persistedCourseRecord = {
          ...persistedCourseRecord,
          ...updatedValues,
          ...(updatedValues.price !== undefined
            ? { price: updatedValues.price * 100 }
            : {})
        }
        return successfulResult({ record: persistedCourseRecord })
      }
      if (
        code.includes('const helperIdentity =') &&
        code.includes('A Bridge lens helper must return')
      ) {
        const query = readEmbeddedValue(code, 'query')
        expect(query.columns).toEqual(['title', 'price', 'createdAt'])
        return successfulResult({
          records,
          total: records.length
        })
      }
      if (code.includes('const helperIdentity =')) {
        const helperIdentity = readEmbeddedValue(code, 'helperIdentity')
        return successfulResult({
          message:
            helperIdentity === 'bridge.syncCatalog'
              ? 'Catalog synchronized.'
              : helperIdentity === 'bridge.publishCourse'
              ? 'Course published.'
              : 'Licenses regenerated.'
        })
      }
      if (code.includes('const record = await model.findOne(criteria)')) {
        if (code.includes('const identity = "user";')) {
          return successfulResult({
            record: {
              id: creatorId,
              fullName: 'Ada Lovelace',
              email: 'ada@example.com',
              githubAccessToken: 'gho_never-render-this',
              emailChangeCandidate: 'private-candidate@example.com',
              planCode: 'private-plan',
              subscriptionCode: 'private-subscription',
              unexpectedSerializerValue: 'never-render-this-either'
            }
          })
        }
        const criteria = readEmbeddedValue(code, 'criteria')
        return successfulResult({
          record:
            criteria.id === createdCourseRecordId
              ? persistedCourseRecord
              : record
        })
      }

      return {
        success: false,
        output: '',
        error: 'Unexpected Bridge query in UI trial.'
      }
    }

    try {
      await page.raw.route('**/api/v1/system/check-update', async (route) => {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ updateAvailable: false })
        })
      })
      await page.raw.route(
        'https://cdn.example.com/courses/**',
        async (route) => {
          await route.fulfill({
            status: 200,
            contentType: 'image/svg+xml',
            body: `
              <svg xmlns="http://www.w3.org/2000/svg" width="640" height="400" viewBox="0 0 640 400">
                <defs>
                  <linearGradient id="sea" x1="0" x2="1" y1="0" y2="1">
                    <stop stop-color="#0ea5e9"/>
                    <stop offset="1" stop-color="#0f172a"/>
                  </linearGradient>
                </defs>
                <rect width="640" height="400" fill="url(#sea)"/>
                <path d="M0 290 C140 230 250 360 390 285 S550 245 640 300 V400 H0Z" fill="#fff" fill-opacity=".16"/>
                <text x="48" y="90" fill="#fff" font-family="system-ui" font-size="24" font-weight="600">Build a production Sails app</text>
              </svg>
            `
          })
        }
      )
      await page.raw.route(
        '**/bridge/course/description/upload',
        async (route) => {
          inlineUploadRequestBody = route.request().postData() || ''
          await route.fulfill({
            status: 200,
            contentType: 'application/json',
            body: JSON.stringify({
              url: 'https://cdn.example.com/courses/descriptions/release-diagram.png',
              receipt: 'signed-inline-image-receipt',
              file: {
                name: 'release-diagram.png',
                size: 68,
                type: 'image/png'
              }
            })
          })
        }
      )
      await login.withPassword('genesisUser', page, {
        password: current.auth.genesisUserPassword
      })
      await page.raw.waitForURL((url) => !url.pathname.startsWith('/login'), {
        timeout: 10000
      })
      await page.raw.setViewportSize({ width: 1440, height: 900 })

      const bridgePath = `/projects/${project.slug}/environments/${environment.slug}/bridge`
      const coursePath = `${bridgePath}/course`

      await page.goto(bridgePath)
      await page.wait('text=Courses')
      const bridgeBreadcrumb = page.raw.locator(
        '[data-test="bridge-page-header"] [data-slot="breadcrumb"]'
      )
      expect(await bridgeBreadcrumb.count()).toBe(1)
      expect(
        (
          await bridgeBreadcrumb.locator('[aria-current="page"]').textContent()
        ).trim()
      ).toBe('bridge')
      await expect(page).toSee('4 resources')
      expect(
        await page.raw
          .locator('[data-test^="bridge-resource-row-"]')
          .locator('[data-test="bridge-resource-label"]')
          .allTextContents()
      ).toEqual(['Chapters', 'Courses', 'Lessons', 'People'])
      expect(
        await page.raw
          .locator('[data-test^="bridge-resource-row-"]')
          .locator('[data-test="bridge-resource-record-count"]')
          .allTextContents()
      ).toEqual(['0', '3', '0', '1'])
      for (const removedGroup of [
        'Audience',
        'Commerce',
        'Content',
        'Operations',
        'Resources'
      ]) {
        expect(
          await page.raw.getByText(removedGroup, { exact: true }).count()
        ).toBe(0)
      }
      const resourceSearch = page.raw.getByPlaceholder('Search resources...')
      await resourceSearch.fill('Person')
      expect(
        await page.raw
          .locator('[data-test="bridge-resource-label"]')
          .allTextContents()
      ).toEqual(['People'])
      await resourceSearch.fill('users')
      expect(
        await page.raw
          .locator('[data-test="bridge-resource-label"]')
          .allTextContents()
      ).toEqual(['People'])
      await resourceSearch.fill('Content')
      expect(
        await page.raw
          .locator('[data-test="bridge-resource-label"]')
          .allTextContents()
      ).toEqual([])
      await resourceSearch.fill('')
      expect(await page.raw.getByText('Model Settings').count()).toBe(0)
      await page.screenshot(path.join(screenshotRoot, 'resources-light.png'), {
        fullPage: true
      })

      await page.raw.emulateMedia({ colorScheme: 'dark' })
      await page.screenshot(path.join(screenshotRoot, 'resources-dark.png'), {
        fullPage: true
      })
      await page.raw.emulateMedia({ colorScheme: 'light' })

      await page.goto(coursePath)
      await page.wait('text=Build a production Sails app')
      await expect(page).toSee('Course title')
      await expect(page).toSee('$34.99')
      expect(await page.raw.locator('input[type="checkbox"]').count()).toBe(4)
      const dataTable = page.raw.locator('[data-slot="data-table"]')
      await expect(dataTable).toBeVisible()
      await expect(dataTable.locator('table')).toHaveAttribute(
        'data-slot',
        'table'
      )
      await expect(
        dataTable.getByRole('checkbox', {
          name: 'Select all records on this page'
        })
      ).toBeVisible()
      expect(
        await dataTable
          .locator('tbody input[type="checkbox"]')
          .first()
          .getAttribute('aria-label')
      ).toMatch(/^Select /)

      const titleHeader = dataTable
        .getByRole('columnheader')
        .filter({ hasText: 'Course title' })
      expect(await titleHeader.getAttribute('aria-sort')).toBe(null)
      await titleHeader
        .getByRole('button', { name: 'Sort by Course title ascending' })
        .click()
      await page.raw.waitForURL(
        (url) => url.searchParams.get('sort') === 'title ASC'
      )
      await expect(titleHeader).toHaveAttribute('aria-sort', 'ascending')
      expect(
        await page.raw.evaluate(
          () => document.activeElement?.dataset.tableFocus
        )
      ).toBe('sort:title')
      await page.goto(coursePath)
      await page.wait('text=Build a production Sails app')
      await page.screenshot(
        path.join(screenshotRoot, 'course-list-light.png'),
        {
          fullPage: true
        }
      )
      await page.screenshot(
        path.join(fieldEngineScreenshotRoot, 'typed-list-light.png'),
        { fullPage: true }
      )
      await page.raw.emulateMedia({ colorScheme: 'dark' })
      await page.screenshot(
        path.join(fieldEngineScreenshotRoot, 'typed-list-dark.png'),
        { fullPage: true }
      )
      await page.raw.emulateMedia({ colorScheme: 'light' })

      await page.raw.locator('[data-test="bridge-filter-toggle"]').click()
      await expect(
        page.raw.getByRole('search', { name: 'Filter records' })
      ).toHaveAttribute('data-slot', 'filter-bar')
      await page.raw
        .locator('[data-test="bridge-filter-panel"]')
        .waitFor({ state: 'visible' })
      await page.raw.locator('#bridge-filter-title-value').fill('discard me')
      await page.raw.keyboard.press('Escape')
      await expect(
        page.raw.locator('[data-test="bridge-filter-panel"]')
      ).not.toBeVisible()
      expect(
        await page.raw.evaluate(() => document.activeElement?.dataset.test)
      ).toBe('bridge-filter-toggle')
      expect(new URL(page.raw.url()).searchParams.has('filters')).toBe(false)

      await page.raw.locator('[data-test="bridge-filter-toggle"]').click()
      await expect(page.raw.locator('#bridge-filter-title-value')).toHaveValue(
        ''
      )
      await page.screenshot(
        path.join(filterScreenshotRoot, 'filter-menu-light.png'),
        { fullPage: true }
      )
      await page.raw.emulateMedia({ colorScheme: 'dark' })
      await page.screenshot(
        path.join(filterScreenshotRoot, 'filter-menu-dark.png'),
        { fullPage: true }
      )
      await page.raw.emulateMedia({ colorScheme: 'light' })
      await page.raw.locator('#bridge-filter-title-value').fill('production')
      await page.raw.locator('#bridge-filter-published-value').click()
      await page.raw.getByRole('option', { name: 'Yes', exact: true }).click()
      await page.raw.locator('#bridge-filter-creator-value').click()
      await page.wait('text=Ada Lovelace')
      await page.screenshot(
        path.join(filterScreenshotRoot, 'belongs-to-filter-light.png'),
        { fullPage: true }
      )
      await page.raw
        .getByRole('option', { name: 'Ada Lovelace', exact: true })
        .click()
      await page.raw.getByRole('button', { name: 'Apply' }).click()
      await page.raw.waitForURL((url) => url.searchParams.has('filters'))
      expect(
        JSON.parse(new URL(page.raw.url()).searchParams.get('filters'))
      ).toEqual({
        title: { operator: 'contains', value: 'production' },
        published: { operator: 'equals', value: 'true' },
        creator: { operator: 'equals', value: creatorId }
      })
      expect(resourceQueries.at(-1).where).toEqual({
        and: [
          { title: { contains: 'production' } },
          { published: true },
          { creator: creatorId }
        ]
      })
      expect(
        await page.raw
          .locator('[data-test="bridge-filter-toggle"] span')
          .textContent()
      ).toBe('3')
      await page.screenshot(
        path.join(filterScreenshotRoot, 'active-filters-light.png'),
        { fullPage: true }
      )

      await page.raw.locator('[data-test="bridge-filter-toggle"]').click()
      await page.raw.getByRole('button', { name: 'Reset filters' }).click()
      await page.raw.waitForURL((url) => !url.searchParams.has('filters'))
      expect(
        await page.raw.evaluate(() => document.activeElement?.dataset.test)
      ).toBe('bridge-filter-toggle')

      await page.raw.goBack()
      await page.raw.waitForURL((url) => url.searchParams.has('filters'))
      expect(
        JSON.parse(new URL(page.raw.url()).searchParams.get('filters'))
      ).toEqual({
        title: { operator: 'contains', value: 'production' },
        published: { operator: 'equals', value: 'true' },
        creator: { operator: 'equals', value: creatorId }
      })
      await page.raw.goForward()
      await page.raw.waitForURL((url) => !url.searchParams.has('filters'))

      await page.raw.locator('[data-test="bridge-lens-select"]').click()
      await page.raw
        .getByRole('option', { name: 'Recently active', exact: true })
        .click()
      await page.raw.waitForURL(
        (url) => url.searchParams.get('lens') === 'recent'
      )
      expect(new URL(page.raw.url()).searchParams.has('filters')).toBe(false)
      await expect(page).toSee('Recently active')
      await page.screenshot(
        path.join(filterScreenshotRoot, 'saved-lens-light.png'),
        { fullPage: true }
      )
      await page.raw.emulateMedia({ colorScheme: 'dark' })
      await page.screenshot(
        path.join(filterScreenshotRoot, 'saved-lens-dark.png'),
        { fullPage: true }
      )
      await page.raw.emulateMedia({ colorScheme: 'light' })
      await page.raw.locator('[data-test="bridge-lens-select"]').click()
      await page.raw
        .getByRole('option', { name: 'All records', exact: true })
        .click()
      await page.raw.waitForURL((url) => !url.searchParams.has('lens'))

      const resourceActionsButton = page.raw.getByRole('button', {
        name: 'Actions for Courses'
      })
      await resourceActionsButton.click()
      await expect(page).toSee('Sync catalog')
      await page.screenshot(
        path.join(actionScreenshotRoot, 'resource-actions-light.png'),
        { fullPage: true }
      )
      await page.raw.emulateMedia({ colorScheme: 'dark' })
      await page.screenshot(
        path.join(actionScreenshotRoot, 'resource-actions-dark.png'),
        { fullPage: true }
      )
      await page.raw.emulateMedia({ colorScheme: 'light' })
      await page.raw
        .getByRole('menuitem', { name: 'Sync catalog', exact: true })
        .click()
      await page.wait('text=Catalog synchronized.')
      await page.raw
        .getByText('Catalog synchronized.', { exact: true })
        .locator('..')
        .getByRole('button')
        .click()

      const rowCheckboxes = page.raw.locator('tbody input[type="checkbox"]')
      await rowCheckboxes.nth(0).click()
      await rowCheckboxes.nth(1).click()
      await page.raw
        .getByRole('button', { name: 'Actions for selected records' })
        .click()
      await expect(page).toSee('Regenerate licenses')
      await page.screenshot(
        path.join(actionScreenshotRoot, 'bulk-actions-menu-light.png'),
        { fullPage: true }
      )
      await page.raw.emulateMedia({ colorScheme: 'dark' })
      await page.screenshot(
        path.join(actionScreenshotRoot, 'bulk-actions-menu-dark.png'),
        { fullPage: true }
      )
      await page.raw.emulateMedia({ colorScheme: 'light' })
      await page.raw
        .getByRole('menuitem', {
          name: 'Regenerate licenses',
          exact: true
        })
        .click()
      await page.raw
        .locator('[data-test="bridge-action-dialog-regenerateLicenses"]')
        .waitFor({ state: 'visible' })
      await page.wait(250)
      await page.screenshot(
        path.join(actionScreenshotRoot, 'bulk-action-dialog-light.png'),
        { fullPage: true }
      )
      await page.raw.emulateMedia({ colorScheme: 'dark' })
      await page.screenshot(
        path.join(actionScreenshotRoot, 'bulk-action-dialog-dark.png'),
        { fullPage: true }
      )
      await page.raw.emulateMedia({ colorScheme: 'light' })
      await page.raw.getByRole('button', { name: 'Cancel' }).click()
      await rowCheckboxes.nth(0).click()
      await rowCheckboxes.nth(1).click()

      const actionsButton = page.raw.getByRole('button', {
        name: 'Actions for Build a production Sails app'
      })
      expect(await actionsButton.count()).toBe(1)
      await actionsButton.click()
      await expect(page).toSee('View record')
      await expect(page).toSee('Edit record')
      await expect(page).toSee('Delete record')
      await page.screenshot(
        path.join(screenshotRoot, 'course-actions-light.png'),
        {
          fullPage: true
        }
      )
      await page.raw.emulateMedia({ colorScheme: 'dark' })
      await page.screenshot(
        path.join(screenshotRoot, 'course-actions-dark.png'),
        {
          fullPage: true
        }
      )
      await page.raw.emulateMedia({ colorScheme: 'light' })
      await page.raw.keyboard.press('Escape')

      await page.goto(`${coursePath}/new`)
      await page.wait('text=Create Course')
      await expect(page).toSee('Course description')
      await expect(page).toSee('Thumbnail')
      await expect(page).toSee('Price')
      await expect(page).toSee('Order')
      await expect(page).toSee('Website')
      await expect(page).toSee('Metadata')
      await expect(page).toSee('Creator')
      expect(await page.raw.getByLabel('Id').count()).toBe(0)
      const publishedSwitch = page.raw.locator(
        '[data-test="bridge-course-published-input"]'
      )
      expect(await publishedSwitch.getAttribute('type')).toBe('checkbox')
      expect(await publishedSwitch.getAttribute('role')).toBe('switch')
      expect(await publishedSwitch.getAttribute('data-state')).toBe('unchecked')
      await page.raw.locator('label[for="bridge-course-published"]').click()
      expect(await publishedSwitch.isChecked()).toBe(true)
      await publishedSwitch.focus()
      await page.raw.keyboard.press('Space')
      expect(await publishedSwitch.isChecked()).toBe(false)
      const createRecordButton = page.raw.getByRole('button', {
        name: 'Create record'
      })
      expect(await createRecordButton.isDisabled()).toBe(true)
      await page.screenshot(
        path.join(fieldEngineScreenshotRoot, 'typed-create-light.png'),
        { fullPage: true }
      )
      await createRecordButton.scrollIntoViewIfNeeded()
      await page.screenshot(
        path.join(
          fieldEngineScreenshotRoot,
          'typed-create-required-fields-light.png'
        ),
        { fullPage: true }
      )
      const courseTitle = page.raw.getByLabel('Course title')
      await courseTitle.fill('Existing course')
      await courseTitle.blur()
      await page.wait('text=Course title is already in use')
      await courseTitle.evaluate((element) => {
        element.scrollIntoView({ block: 'center' })
      })
      await page.screenshot(
        path.join(precognitionScreenshotRoot, 'bridge-field-error-light.png'),
        { fullPage: true }
      )
      await page.raw.emulateMedia({ colorScheme: 'dark' })
      await page.screenshot(
        path.join(precognitionScreenshotRoot, 'bridge-field-error-dark.png'),
        { fullPage: true }
      )
      await page.raw.emulateMedia({ colorScheme: 'light' })
      await courseTitle.fill('Ship a durable course')
      await page.raw
        .getByText('Course title is already in use', { exact: false })
        .waitFor({ state: 'hidden' })
      const priceInput = page.raw.getByLabel('Price')
      const orderInput = page.raw.getByLabel('Order')
      for (const numericInput of [priceInput, orderInput]) {
        expect(await numericInput.getAttribute('type')).toBe('number')
        expect(await numericInput.getAttribute('inputmode')).toBe('decimal')
        expect(await numericInput.getAttribute('step')).toBe('any')
        expect(
          (await numericInput.getAttribute('class')).includes(
            'bridge-number-input'
          )
        ).toBe(true)
        expect(
          await numericInput.evaluate(
            (element) => getComputedStyle(element).appearance
          )
        ).toBe('textfield')
      }
      expect(await orderInput.getAttribute('min')).toBe('0')
      expect(await orderInput.getAttribute('max')).toBe('999')
      await priceInput.fill('49')
      await orderInput.fill('5')
      await page.raw.setViewportSize({ width: 1440, height: 1100 })
      const creatorRelationshipSelect = page.raw.getByRole('combobox', {
        name: 'Creator'
      })
      await creatorRelationshipSelect.evaluate((element) => {
        element.scrollIntoView({ block: 'center' })
      })
      await creatorRelationshipSelect.click()
      await page.wait('text=Ada Lovelace')
      const creatorSearch = page.raw.getByRole('searchbox', {
        name: 'Search creator'
      })
      const creatorSearchClass = await creatorSearch.getAttribute('class')
      expect(creatorSearchClass.includes('border-b')).toBe(true)
      expect(creatorSearchClass.includes('border-dashed')).toBe(true)
      expect(creatorSearchClass.includes('bg-transparent')).toBe(true)
      expect(creatorSearchClass.includes('rounded')).toBe(false)
      expect(creatorSearchClass.includes('ring-1')).toBe(false)
      expect(
        await creatorSearch.evaluate(
          (element) => getComputedStyle(element).borderBottomStyle
        )
      ).toBe('dashed')
      await creatorSearch.fill('Ada')
      await page.wait('text=Ada Lovelace')
      await page.screenshot(
        path.join(
          relationshipScreenshotRoot,
          'searchable-creator-select-light.png'
        ),
        { fullPage: true }
      )
      await page.raw.emulateMedia({ colorScheme: 'dark' })
      await page.screenshot(
        path.join(
          relationshipScreenshotRoot,
          'searchable-creator-select-dark.png'
        ),
        { fullPage: true }
      )
      await page.raw.emulateMedia({ colorScheme: 'light' })
      await page.raw
        .getByRole('option', { name: 'Ada Lovelace', exact: true })
        .click()
      await page.raw.setViewportSize({ width: 1440, height: 900 })
      expect(await createRecordButton.isEnabled()).toBe(true)
      await createRecordButton.scrollIntoViewIfNeeded()
      await page.screenshot(
        path.join(fieldEngineScreenshotRoot, 'typed-create-ready-light.png'),
        { fullPage: true }
      )
      await page.raw.emulateMedia({ colorScheme: 'dark' })
      await page.screenshot(
        path.join(fieldEngineScreenshotRoot, 'typed-create-ready-dark.png'),
        { fullPage: true }
      )
      await page.raw.emulateMedia({ colorScheme: 'light' })
      await page.screenshot(
        path.join(
          identifierScreenshotRoot,
          'course-create-uuid-association-light.png'
        ),
        { fullPage: true }
      )
      await page.raw.emulateMedia({ colorScheme: 'dark' })
      await page.screenshot(
        path.join(
          identifierScreenshotRoot,
          'course-create-uuid-association-dark.png'
        ),
        { fullPage: true }
      )
      await page.raw.emulateMedia({ colorScheme: 'light' })

      const descriptionEditor = page.raw.locator(
        '[data-test="bridge-course-description-visual-editor"]'
      )
      expect(await descriptionEditor.count()).toBe(1)
      expect(await descriptionEditor.getAttribute('aria-labelledby')).toBe(
        'bridge-course-description-label'
      )

      await descriptionEditor.click()
      await page.raw.keyboard.type('## ')
      await page.raw.keyboard.type('Ship with confidence')
      expect(await descriptionEditor.locator('h2').textContent()).toBe(
        'Ship with confidence'
      )
      await page.raw.keyboard.press('Enter')
      await page.raw.keyboard.type('Boring releases are good.')
      await page.raw.keyboard.press('Shift+Home')
      expect(
        (await page.script(() => window.getSelection().toString())).includes(
          'Boring releases are good.'
        )
      ).toBe(true)
      await page.wait('@bridge-course-description-format-menu')
      await page.screenshot(
        path.join(screenshotRoot, 'course-richtext-light.png'),
        { fullPage: true }
      )

      await page.raw.getByRole('button', { name: 'Bold', exact: true }).click()
      await page.raw
        .getByRole('button', {
          name: 'Edit Course description as Markdown'
        })
        .click()
      const descriptionSource = page.raw.locator(
        '[data-test="bridge-course-description-markdown-source"]'
      )
      expect(await descriptionSource.inputValue()).toContain(
        '**Boring releases are good.**'
      )
      await page.raw
        .getByRole('button', {
          name: 'Edit Course description as Visual'
        })
        .click()
      await descriptionEditor.click()
      await page.raw.keyboard.press('ControlOrMeta+End')
      await page.raw.keyboard.press('Enter')
      await descriptionEditor.evaluate((element) => {
        const bytes = Uint8Array.from(
          atob(
            'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADElEQVR42mNk+M/wHwAF/gL+Xhc4VQAAAABJRU5ErkJggg=='
          ),
          (character) => character.charCodeAt(0)
        )
        const clipboard = new DataTransfer()
        clipboard.items.add(
          new File([bytes], 'release-diagram.png', { type: 'image/png' })
        )
        element.dispatchEvent(
          new ClipboardEvent('paste', {
            bubbles: true,
            cancelable: true,
            clipboardData: clipboard
          })
        )
      })
      const inlineImage = descriptionEditor.locator(
        'img[src="https://cdn.example.com/courses/descriptions/release-diagram.png"]'
      )
      await inlineImage.waitFor({ state: 'visible' })
      expect(inlineUploadRequestBody).toContain('Ship a durable course')
      await page.screenshot(
        path.join(
          sailscastsScreenshotRoot,
          'richtext-inline-image-upload-light.png'
        ),
        { fullPage: true }
      )
      await page.raw.emulateMedia({ colorScheme: 'dark' })
      await page.screenshot(
        path.join(
          sailscastsScreenshotRoot,
          'richtext-inline-image-upload-dark.png'
        ),
        { fullPage: true }
      )
      await page.raw.emulateMedia({ colorScheme: 'light' })
      await page.raw
        .getByRole('button', {
          name: 'Edit Course description as Markdown'
        })
        .click()
      expect(await descriptionSource.inputValue()).toContain(
        '**Boring releases are good.**'
      )
      expect(await descriptionSource.inputValue()).toContain(
        'https://cdn.example.com/courses/descriptions/release-diagram.png'
      )
      const createdMarkdown = await descriptionSource.inputValue()
      await descriptionSource.fill(
        `${createdMarkdown}\n\n<script>alert('unsafe')</script>`
      )
      await expect(page).toSee(
        'Raw HTML is not allowed in Bridge Markdown fields.'
      )
      expect(await createRecordButton.isDisabled()).toBe(true)
      await page.screenshot(
        path.join(screenshotRoot, 'course-richtext-html-blocked.png'),
        { fullPage: true }
      )
      await descriptionSource.fill(createdMarkdown)
      expect(await createRecordButton.isEnabled()).toBe(true)

      await page.raw.emulateMedia({ colorScheme: 'dark' })
      await page.wait(100)
      await page.screenshot(
        path.join(screenshotRoot, 'course-richtext-source-dark.png'),
        { fullPage: true }
      )

      await page.raw
        .getByRole('button', {
          name: 'Edit Course description as Visual'
        })
        .click()
      await page.raw.emulateMedia({ colorScheme: 'dark' })
      await page.screenshot(
        path.join(screenshotRoot, 'course-richtext-dark.png'),
        { fullPage: true }
      )
      await page.raw.emulateMedia({ colorScheme: 'light' })

      await createRecordButton.click()
      await page.raw.waitForURL(
        (url) => url.pathname.endsWith(`/${createdCourseRecordId}`),
        { timeout: 10000 }
      )
      expect(createdValues.description).toBe(createdMarkdown)
      expect(createdValues.id).toBe(createdCourseRecordId)
      expect(createdValues.creator).toBe(creatorId)
      expect(createdValues.price).toBe(49)
      expect(createdValues.order).toBe(5)
      await expect(page).toSee('Ship a durable course')

      await page.goto(`${coursePath}/${createdCourseRecordId}/edit`)
      await page.wait('text=Edit Course')
      await page.raw
        .getByRole('button', {
          name: 'Edit Course description as Markdown'
        })
        .click()
      const persistedDescriptionSource = page.raw.locator(
        '[data-test="bridge-course-description-markdown-source"]'
      )
      expect(await persistedDescriptionSource.inputValue()).toBe(
        createdMarkdown
      )
      const updatedMarkdown = `${createdMarkdown}\n\nA safe production update.`
      await persistedDescriptionSource.fill(updatedMarkdown)
      await page.raw
        .getByRole('button', {
          name: 'Edit Course description as Visual'
        })
        .click()

      await page.raw.setViewportSize({ width: 390, height: 844 })
      expect(
        await page.script(
          () => document.documentElement.scrollWidth <= window.innerWidth
        )
      ).toBe(true)
      await page.screenshot(
        path.join(screenshotRoot, 'course-richtext-mobile.png'),
        { fullPage: true }
      )
      await page.raw.getByRole('button', { name: 'Save changes' }).click()
      await page.raw.waitForURL(
        (url) => url.pathname.endsWith(`/${createdCourseRecordId}`),
        { timeout: 10000 }
      )
      expect(updatedValues.description).toBe(updatedMarkdown)
      expect(updatedValues.price).toBe(49)

      await page.raw.setViewportSize({ width: 1440, height: 900 })
      await page.goto(`${coursePath}/${createdCourseRecordId}/edit`)
      await page.wait('text=Edit Course')
      await page.raw
        .getByRole('button', {
          name: 'Edit Course description as Markdown'
        })
        .click()
      expect(
        await page.raw
          .locator('[data-test="bridge-course-description-markdown-source"]')
          .inputValue()
      ).toBe(updatedMarkdown)

      await page.goto(`${coursePath}/${courseRecordId}`)
      await page.wait('text=A practical path')
      await expect(page).toSee('Course description')
      await expect(page).toSee('Thumbnail')
      await expect(page).toSee('$34.99')
      await expect(page).toSee('https://sailsjs.com')
      await expect(page).toSee('"lessons": 12')
      await expect(page).toSee('Ada Lovelace')
      await expect(page).toSee('The deployment path')
      await expect(page).toSee('Deploy with confidence')

      const recordActionsButton = page.raw.getByRole('button', {
        name: 'Actions for Build a production Sails app'
      })
      await recordActionsButton.click()
      await expect(page).toSee('Publish course')
      await page.screenshot(
        path.join(actionScreenshotRoot, 'record-actions-menu-light.png'),
        { fullPage: true }
      )
      await page.raw.emulateMedia({ colorScheme: 'dark' })
      await page.screenshot(
        path.join(actionScreenshotRoot, 'record-actions-menu-dark.png'),
        { fullPage: true }
      )
      await page.raw.emulateMedia({ colorScheme: 'light' })
      await page.raw
        .getByRole('menuitem', { name: 'Publish course', exact: true })
        .click()
      await page.raw
        .locator('[data-test="bridge-action-dialog-publish"]')
        .waitFor({ state: 'visible' })
      await page.wait(250)
      await expect(page).toSee('Publish this course now?')
      const publishButton = page.raw.getByRole('button', {
        name: 'Publish course',
        exact: true
      })
      expect(await publishButton.isDisabled()).toBe(true)
      await page.screenshot(
        path.join(actionScreenshotRoot, 'record-action-dialog-light.png'),
        { fullPage: true }
      )
      await page.raw.getByLabel('Release note').fill('Ready for students.')
      expect(await publishButton.isEnabled()).toBe(true)
      await page.raw.emulateMedia({ colorScheme: 'dark' })
      await page.screenshot(
        path.join(actionScreenshotRoot, 'record-action-dialog-dark.png'),
        { fullPage: true }
      )
      await page.raw.emulateMedia({ colorScheme: 'light' })
      await publishButton.click()
      await page.wait('text=Course published.')

      await page.screenshot(
        path.join(fieldEngineScreenshotRoot, 'typed-record-light.png'),
        { fullPage: true }
      )
      await page.screenshot(
        path.join(relationshipScreenshotRoot, 'course-relations-light.png'),
        { fullPage: true }
      )
      await page.raw.emulateMedia({ colorScheme: 'dark' })
      await page.screenshot(
        path.join(screenshotRoot, 'course-record-dark.png'),
        {
          fullPage: true
        }
      )
      await page.screenshot(
        path.join(fieldEngineScreenshotRoot, 'typed-record-dark.png'),
        { fullPage: true }
      )
      await page.screenshot(
        path.join(relationshipScreenshotRoot, 'course-relations-dark.png'),
        { fullPage: true }
      )

      await page.raw.emulateMedia({ colorScheme: 'light' })
      await page.raw
        .getByRole('button', { name: 'Manage lessons', exact: true })
        .click()
      await page.wait('text=Operate the boring path')
      const collectionSearch = page.raw.getByRole('searchbox', {
        name: 'Search lessons'
      })
      const collectionSearchClass = await collectionSearch.getAttribute('class')
      expect(collectionSearchClass.includes('border-b')).toBe(true)
      expect(collectionSearchClass.includes('border-dashed')).toBe(true)
      expect(collectionSearchClass.includes('bg-transparent')).toBe(true)
      expect(collectionSearchClass.includes('rounded')).toBe(false)
      expect(collectionSearchClass.includes('ring-1')).toBe(false)
      await collectionSearch.fill('Operate')
      await page.wait('text=Operate the boring path')
      await expect(page).toSee('Remove')
      await expect(page).toSee('Attach')
      await page.screenshot(
        path.join(relationshipScreenshotRoot, 'manage-lessons-light.png'),
        { fullPage: true }
      )
      await page.raw.emulateMedia({ colorScheme: 'dark' })
      await page.screenshot(
        path.join(relationshipScreenshotRoot, 'manage-lessons-dark.png'),
        { fullPage: true }
      )
      await page.raw
        .getByRole('button', { name: 'Close relationship manager' })
        .click()

      await page.raw.emulateMedia({ colorScheme: 'light' })
      await page.goto(`${bridgePath}/lesson/new`)
      await page.wait('text=Create Lesson')
      const courseSelect = page.raw.getByRole('combobox', { name: 'Course' })
      const chapterSelect = page.raw.getByRole('combobox', { name: 'Chapter' })
      const lessonCreatorSelect = page.raw.getByRole('combobox', {
        name: 'Creator'
      })

      expect(await chapterSelect.isDisabled()).toBe(true)
      await expect(chapterSelect).toHaveText('Choose course first')

      await courseSelect.click()
      await page.raw
        .getByRole('option', {
          name: 'Build a production Sails app',
          exact: true
        })
        .click()
      expect(await chapterSelect.isEnabled()).toBe(true)
      await chapterSelect.click()
      await page.wait('text=The deployment path')
      await page.raw
        .getByRole('option', { name: 'The deployment path', exact: true })
        .click()
      await expect(chapterSelect).toHaveText('The deployment path')

      await courseSelect.click()
      await page.raw
        .getByRole('option', { name: 'Durable UI', exact: true })
        .click()
      await expect(chapterSelect).toHaveText('Select…')
      await chapterSelect.click()
      await page.wait('text=Durable form state')
      expect(
        await page.raw
          .getByRole('option', { name: 'The deployment path', exact: true })
          .count()
      ).toBe(0)
      await page.screenshot(
        path.join(
          relationshipScreenshotRoot,
          'dependent-relationship-fields-light.png'
        ),
        { fullPage: true }
      )
      await page.raw.emulateMedia({ colorScheme: 'dark' })
      await page.screenshot(
        path.join(
          relationshipScreenshotRoot,
          'dependent-relationship-fields-dark.png'
        ),
        { fullPage: true }
      )
      await page.raw.emulateMedia({ colorScheme: 'light' })
      await page.raw
        .getByRole('option', { name: 'Durable form state', exact: true })
        .click()

      await lessonCreatorSelect.click()
      await page.wait('text=Ada Lovelace')

      await page.raw.emulateMedia({ colorScheme: 'light' })
      await page.goto(`${bridgePath}/user/${creatorId}`)
      await page.wait('text=Ada Lovelace')
      await expect(page).toSee('ada@example.com')
      await expect(page).not.toSee('gho_never-render-this')
      await expect(page).not.toSee('private-candidate@example.com')
      await expect(page).not.toSee('private-plan')
      await expect(page).not.toSee('private-subscription')
      expect(
        await page.raw.getByRole('link', { name: 'Edit', exact: true }).count()
      ).toBe(0)
      expect(
        await page.raw
          .getByRole('button', { name: 'Delete', exact: true })
          .count()
      ).toBe(0)
      await page.screenshot(
        path.join(
          authorizationScreenshotRoot,
          'editor-record-redacted-light.png'
        ),
        { fullPage: true }
      )
      await page.raw.emulateMedia({ colorScheme: 'dark' })
      await page.screenshot(
        path.join(
          authorizationScreenshotRoot,
          'editor-record-redacted-dark.png'
        ),
        { fullPage: true }
      )
    } finally {
      sails.helpers.bridge.introspectModels = originalIntrospectModels
      sails.helpers.bridge.buildSailsWrapper = originalBuildSailsWrapper
      sails.helpers.bridge.executeInContainer = originalExecuteInContainer
    }
  }
)

function successfulResult(output) {
  return {
    success: true,
    output: JSON.stringify(output),
    error: null,
    exitCode: 0
  }
}

function readEmbeddedValue(code, name) {
  const match = code.match(new RegExp(`const ${name} = (.*);`))
  if (!match) throw new Error(`Missing ${name} declaration in Bridge query.`)
  return JSON.parse(match[1])
}

function resourceConfig() {
  return {
    schemaVersion: 1,
    resources: {
      course: {
        label: 'Courses',
        singularLabel: 'Course',
        title: 'title',
        search: ['title'],
        list: ['title', 'price', 'published', 'createdAt'],
        show: [
          'id',
          'title',
          'description',
          'thumbnailUrl',
          'price',
          'website',
          'metadata',
          'published',
          'creator'
        ],
        create: [
          'title',
          'description',
          'thumbnailUrl',
          'price',
          'order',
          'website',
          'metadata',
          'published',
          'creator'
        ],
        edit: [
          'title',
          'description',
          'thumbnailUrl',
          'price',
          'website',
          'metadata',
          'published',
          'creator'
        ],
        filters: ['title', 'price', 'published', 'creator', 'createdAt'],
        lenses: {
          published: {
            label: 'Published courses',
            filters: { published: true },
            columns: ['title', 'price', 'published', 'createdAt'],
            sort: {
              field: 'createdAt',
              direction: 'DESC'
            }
          },
          drafts: {
            label: 'Draft courses',
            filters: { published: false },
            columns: ['title', 'price', 'createdAt'],
            sort: {
              field: 'createdAt',
              direction: 'DESC'
            }
          },
          recent: {
            label: 'Recently active',
            columns: ['title', 'price', 'createdAt'],
            sort: {
              field: 'createdAt',
              direction: 'DESC'
            },
            helper: 'bridge.lenses.recentCourses'
          }
        },
        sort: {
          field: 'createdAt',
          direction: 'DESC'
        },
        actions: {
          bulkDelete: false,
          syncCatalog: {
            scope: 'resource',
            helper: 'bridge.syncCatalog',
            label: 'Sync catalog',
            success: 'Catalog synchronized.'
          },
          publish: {
            scope: 'record',
            helper: 'bridge.publishCourse',
            label: 'Publish course',
            description: 'Make this course available to students.',
            confirm: 'Publish this course now?',
            success: 'Course published.',
            fields: {
              notifyStudents: {
                type: 'boolean',
                label: 'Notify students',
                default: true
              },
              releaseNote: {
                type: 'textarea',
                label: 'Release note',
                help: 'Included in the student notification.',
                required: true,
                minLength: 3,
                maxLength: 280
              }
            }
          },
          regenerateLicenses: {
            scope: 'bulk',
            helper: 'bridge.regenerateLicenses',
            label: 'Regenerate licenses',
            description: 'Issue fresh license files for the selected courses.',
            confirm:
              'Existing license download links for these courses will stop working.',
            success: 'Licenses regenerated.',
            destructive: true,
            fields: {
              reason: {
                type: 'select',
                label: 'Reason',
                required: true,
                default: 'security',
                options: [
                  { label: 'Security rotation', value: 'security' },
                  { label: 'Content update', value: 'content' }
                ]
              }
            }
          }
        },
        relationships: {
          chapters: {
            fields: ['id', 'title'],
            search: ['title'],
            limit: 5
          },
          lessons: {
            fields: ['id', 'title'],
            search: ['title'],
            limit: 5,
            attach: true,
            detach: true
          }
        },
        fields: {
          id: {
            default: {
              helper: 'getUuid'
            }
          },
          title: {
            label: 'Course title',
            placeholder: 'A clear, specific course title'
          },
          description: {
            label: 'Course description',
            type: 'richtext',
            format: 'markdown',
            help: 'The public description shown on the course page.',
            upload: {
              kind: 'image',
              storage: 'bridge',
              directory: '{title|slug}/descriptions',
              store: 'url',
              accept: ['image/png'],
              maxBytes: 10 * 1024 * 1024
            }
          },
          thumbnailUrl: {
            label: 'Thumbnail',
            type: 'upload',
            placeholder: 'https://cdn.example.com/courses/thumbnail.webp',
            upload: {
              kind: 'image',
              storage: 'bridge',
              directory: 'courses/thumbnails',
              store: 'url'
            }
          },
          price: {
            label: 'Price',
            type: 'currency',
            currency: {
              code: 'USD',
              storage: 'minor',
              submit: 'major'
            }
          },
          order: {
            label: 'Order',
            type: 'number',
            help: 'Lower numbers appear first.'
          },
          website: {
            label: 'Website',
            type: 'url',
            placeholder: 'https://example.com/course'
          },
          metadata: {
            label: 'Metadata',
            type: 'json',
            help: 'Structured course metadata stored as JSON.'
          },
          creator: {
            label: 'Creator',
            relation: {
              where: { role: 'admin' }
            }
          }
        }
      },
      user: {
        label: 'People',
        singularLabel: 'Person',
        title: 'fullName',
        search: ['fullName', 'email'],
        list: ['fullName', 'email'],
        authorization: {
          helper: 'bridge.authorize'
        },
        actions: {
          bulkDelete: false
        }
      },
      chapter: {
        label: 'Chapters',
        singularLabel: 'Chapter',
        title: 'title',
        search: ['title'],
        list: ['title']
      },
      lesson: {
        label: 'Lessons',
        singularLabel: 'Lesson',
        title: 'title',
        search: ['title'],
        list: ['title'],
        create: ['title', 'course', 'chapter', 'creator'],
        fields: {
          chapter: {
            relation: {
              search: ['title'],
              where: { course: { fromField: 'course' } }
            }
          },
          creator: {
            help: 'Only administrators can be creators.',
            relation: {
              search: ['fullName', 'email'],
              where: { role: 'admin' }
            }
          }
        }
      }
    }
  }
}

function resourceMetadata() {
  return {
    course: {
      identity: 'course',
      globalId: 'Course',
      tableName: 'course',
      primaryKey: 'id',
      attributes: {
        id: {
          type: 'string',
          required: true,
          isUUID: true
        },
        title: {
          type: 'string',
          required: true,
          unique: true
        },
        description: {
          type: 'string',
          columnType: 'text'
        },
        thumbnailUrl: {
          type: 'string'
        },
        price: {
          type: 'number',
          required: true
        },
        order: {
          type: 'number',
          min: 0,
          max: 999
        },
        website: {
          type: 'string',
          isURL: true
        },
        metadata: {
          type: 'json'
        },
        published: {
          type: 'boolean',
          defaultsTo: false
        },
        createdAt: {
          type: 'number',
          autoCreatedAt: true
        },
        updatedAt: {
          type: 'number',
          autoUpdatedAt: true
        },
        creator: {
          type: 'number',
          model: 'user'
        }
      },
      associations: [
        {
          alias: 'creator',
          type: 'model',
          model: 'user'
        },
        {
          alias: 'chapters',
          type: 'collection',
          collection: 'chapter',
          via: 'course'
        },
        {
          alias: 'lessons',
          type: 'collection',
          collection: 'lesson',
          via: 'course'
        }
      ]
    },
    user: {
      identity: 'user',
      globalId: 'User',
      tableName: 'users',
      primaryKey: 'id',
      attributes: {
        id: {
          type: 'string',
          required: true,
          isUUID: true
        },
        fullName: {
          type: 'string',
          required: true
        },
        email: {
          type: 'string',
          isEmail: true,
          required: true
        },
        role: {
          type: 'string',
          isIn: ['student', 'admin'],
          defaultsTo: 'student'
        },
        githubAccessToken: {
          type: 'string'
        },
        emailChangeCandidate: {
          type: 'string'
        },
        planCode: {
          type: 'string'
        },
        subscriptionCode: {
          type: 'string'
        },
        createdAt: {
          type: 'number',
          autoCreatedAt: true
        }
      },
      associations: []
    },
    chapter: {
      identity: 'chapter',
      globalId: 'Chapter',
      tableName: 'chapter',
      primaryKey: 'id',
      attributes: {
        id: {
          type: 'string',
          required: true,
          isUUID: true
        },
        title: {
          type: 'string',
          required: true
        },
        course: {
          type: 'string',
          model: 'course'
        }
      },
      associations: [
        {
          alias: 'course',
          type: 'model',
          model: 'course'
        }
      ]
    },
    lesson: {
      identity: 'lesson',
      globalId: 'Lesson',
      tableName: 'lesson',
      primaryKey: 'id',
      attributes: {
        id: {
          type: 'string',
          required: true,
          isUUID: true
        },
        title: {
          type: 'string',
          required: true
        },
        course: {
          type: 'string',
          model: 'course',
          required: true
        },
        chapter: {
          type: 'string',
          model: 'chapter',
          required: true
        },
        creator: {
          type: 'string',
          model: 'user',
          required: true
        }
      },
      associations: [
        {
          alias: 'course',
          type: 'model',
          model: 'course'
        },
        {
          alias: 'chapter',
          type: 'model',
          model: 'chapter'
        },
        {
          alias: 'creator',
          type: 'model',
          model: 'user'
        }
      ]
    }
  }
}
