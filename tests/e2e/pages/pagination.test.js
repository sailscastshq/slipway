const fs = require('node:fs')
const path = require('node:path')

const { test } = require('sounding')

const capturePhase = process.env.PAGINATION_SCREENSHOT_PHASE || 'after'
const screenshotRoot = path.resolve(
  `.tmp/screenshots/issue-347-pagination/${capturePhase}`
)

test(
  'Bridge pagination keeps the complete resource URL durable',
  {
    browser: true,
    world: {
      name: 'configured-slipway',
      context: {
        deploymentTarget: {
          slug: 'pagination-contract',
          name: 'Pagination contract'
        }
      }
    }
  },
  async ({ sails, world, login, page, expect }) => {
    fs.mkdirSync(screenshotRoot, { recursive: true })

    const current = world.current
    const project = current.projects.deploymentTarget
    const environment = current.environments.production
    const app = current.apps.web
    const originals = {
      loadResource: sails.helpers.bridge.loadResource,
      queryResource: sails.helpers.bridge.queryResource,
      redactResourceRecords: sails.helpers.bridge.redactResourceRecords
    }
    const resource = paginationResource()
    const total = 22

    await sails.models.app.updateOne({ id: app.id }).set({
      status: 'running',
      containerName: 'pagination-contract-web'
    })

    sails.helpers.bridge.loadResource = {
      with: async () => ({
        resource,
        contract: {
          models: { course: resource },
          dashboards: {}
        }
      })
    }
    sails.helpers.bridge.queryResource = {
      with: async ({ query }) => ({
        records: pageRecords(query.page, query.perPage, total),
        total
      })
    }
    sails.helpers.bridge.redactResourceRecords = {
      with: async ({ records }) => records
    }

    try {
      await login.withPassword('genesisUser', page, {
        password: current.auth.genesisUserPassword
      })
      await page.raw.setViewportSize({ width: 1440, height: 900 })

      const filters = JSON.stringify({
        status: { operator: 'equals', value: 'published' }
      })
      const query = new URLSearchParams({
        page: '2',
        perPage: '5',
        search: 'Durable',
        sort: 'title DESC',
        filters,
        lens: 'recent',
        dashboard: 'operators'
      })
      const bridgePath = `/projects/${project.slug}/environments/${environment.slug}/bridge/course?${query}`

      await page.goto(bridgePath)
      await page.wait('text=Durable course 6')
      await page.screenshot(
        path.join(screenshotRoot, 'bridge-pagination-light.png'),
        { fullPage: true }
      )

      await page.raw.emulateMedia({ colorScheme: 'dark' })
      await page.screenshot(
        path.join(screenshotRoot, 'bridge-pagination-dark.png'),
        { fullPage: true }
      )
      await page.raw.emulateMedia({ colorScheme: 'light' })

      if (capturePhase === 'after') {
        const resourceTable = page.raw.locator('[data-slot="table"]')
        await expect(resourceTable).toBeVisible()
        expect(
          (await resourceTable.locator('caption').textContent()).trim()
        ).toBe('Courses records')
        expect(
          await resourceTable.locator('thead th[scope="col"]').count()
        ).toBe(2)

        const pagination = page.raw.locator('[data-test="bridge-pagination"]')
        await expect(pagination).toBeVisible()
        await expect(pagination).toHaveAttribute('data-slot', 'pagination')

        const previous = pagination.locator('[data-slot="previous"]')
        const next = pagination.locator('[data-slot="next"]')
        const previousUrl = new URL(
          await previous.getAttribute('href'),
          'http://slipway.test'
        )
        const nextUrl = new URL(
          await next.getAttribute('href'),
          'http://slipway.test'
        )

        expect(previousUrl.searchParams.has('page')).toBe(false)
        expect(nextUrl.searchParams.get('page')).toBe('3')
        assertResourceQuery(expect, previousUrl, filters)
        assertResourceQuery(expect, nextUrl, filters)

        let partialReload
        page.raw.on('request', (request) => {
          if (
            request.headers()['x-inertia'] === 'true' &&
            new URL(request.url()).searchParams.get('page') === '3'
          ) {
            partialReload = request.headers()['x-inertia-partial-data']
          }
        })

        await next.click()
        await page.raw.waitForURL((url) => url.searchParams.get('page') === '3')
        expect(partialReload).toBe(
          'records,total,totalPages,currentPage,perPage,sort,search,filterState,filterDefinitions,columns,lenses,activeLens,error'
        )

        await page.back()
        await page.raw.waitForURL((url) => url.searchParams.get('page') === '2')
        await page.forward()
        await page.raw.waitForURL((url) => url.searchParams.get('page') === '3')

        await page.raw.locator('[data-slot="page"][data-page="4"]').click()
        await page.raw.waitForURL((url) => url.searchParams.get('page') === '4')
        await page.raw.locator('[data-slot="next"]').click()
        await page.raw.waitForURL((url) => url.searchParams.get('page') === '5')
        await expect(
          page.raw.locator('[data-slot="page"][data-page="5"]')
        ).toBeFocused()
        expect(
          await page.raw.evaluate(() => ({
            slot: document.activeElement?.getAttribute('data-slot'),
            page: document.activeElement?.getAttribute('data-page'),
            disabled: document.activeElement?.getAttribute('aria-disabled'),
            tag: document.activeElement?.tagName
          }))
        ).toEqual({
          slot: 'page',
          page: '5',
          disabled: null,
          tag: 'A'
        })
      }

      expect(page).toHaveNoSmoke()
    } finally {
      sails.helpers.bridge.loadResource = originals.loadResource
      sails.helpers.bridge.queryResource = originals.queryResource
      sails.helpers.bridge.redactResourceRecords =
        originals.redactResourceRecords
    }
  }
)

test(
  'Audit log pagination uses real history-preserving links',
  { browser: true, world: 'configured-slipway' },
  async ({ sails, world, login, page, expect }) => {
    fs.mkdirSync(screenshotRoot, { recursive: true })

    const current = world.current
    const owner = current.users.genesisUser
    const team = current.teams.genesisTeam

    await sails.models.auditlog.createEach(
      Array.from({ length: 105 }, (_, index) => ({
        action: 'helm.executed',
        resourceType: 'app',
        resourceId: `pagination-${String(index + 1).padStart(3, '0')}`,
        details: {
          sourceHash: String(index + 1).padStart(64, 'a'),
          status: 'success'
        },
        user: owner.id,
        team: team.id
      }))
    )

    await login.withPassword('genesisUser', page, {
      password: current.auth.genesisUserPassword
    })
    await page.raw.setViewportSize({ width: 1440, height: 900 })
    await page.goto('/settings/audit-log?page=2&q=pagination&group=helm')
    await page.wait('text=51–100 of 105 events.')

    const footer = page.raw.locator('main footer')
    await footer.screenshot({
      path: path.join(screenshotRoot, 'audit-pagination-light.png')
    })
    await page.raw.emulateMedia({ colorScheme: 'dark' })
    await footer.screenshot({
      path: path.join(screenshotRoot, 'audit-pagination-dark.png')
    })
    await page.raw.emulateMedia({ colorScheme: 'light' })

    if (capturePhase === 'after') {
      const pagination = footer.locator('[data-test="audit-pagination"]')
      await expect(pagination).toBeVisible()
      await expect(pagination).toHaveAttribute('data-slot', 'pagination')

      const previous = pagination.locator('[data-slot="previous"]')
      const next = pagination.locator('[data-slot="next"]')
      const previousUrl = new URL(
        await previous.getAttribute('href'),
        'http://slipway.test'
      )
      const nextUrl = new URL(
        await next.getAttribute('href'),
        'http://slipway.test'
      )

      expect(previousUrl.search).toBe('?q=pagination&group=helm')
      expect(nextUrl.searchParams.get('page')).toBe('3')
      expect(nextUrl.searchParams.get('q')).toBe('pagination')
      expect(nextUrl.searchParams.get('group')).toBe('helm')

      let partialReload
      page.raw.on('request', (request) => {
        if (
          request.headers()['x-inertia'] === 'true' &&
          new URL(request.url()).searchParams.get('page') === '3'
        ) {
          partialReload = request.headers()['x-inertia-partial-data']
        }
      })

      await next.click()
      await page.raw.waitForURL((url) => url.searchParams.get('page') === '3')
      expect(partialReload).toBe(
        'logs,pagination,filters,helmAuditRetentionDays'
      )
      await page.back()
      await page.raw.waitForURL((url) => url.searchParams.get('page') === '2')
      await page.forward()
      await page.raw.waitForURL((url) => url.searchParams.get('page') === '3')
    }

    expect(page).toHaveNoSmoke()
  }
)

function paginationResource() {
  return {
    identity: 'course',
    label: 'Courses',
    singularLabel: 'Course',
    primaryKey: 'id',
    attributes: {
      id: {
        type: 'number',
        label: 'ID',
        field: { type: 'number', sortable: true }
      },
      title: {
        type: 'string',
        label: 'Course title',
        field: { type: 'text', sortable: true }
      },
      status: {
        type: 'string',
        label: 'Status',
        field: {
          type: 'select',
          sortable: true,
          options: [
            { label: 'Draft', value: 'draft' },
            { label: 'Published', value: 'published' }
          ]
        }
      }
    },
    list: ['title', 'status'],
    search: ['title'],
    filters: ['status'],
    sort: { field: 'title', direction: 'ASC' },
    lenses: {
      recent: {
        id: 'recent',
        label: 'Recent courses',
        columns: ['title', 'status'],
        sort: { field: 'title', direction: 'DESC' },
        filters: {}
      }
    },
    actions: {
      view: false,
      update: false,
      delete: false,
      bulkDelete: false
    },
    actionDefinitions: {},
    relationships: {}
  }
}

function pageRecords(currentPage, perPage, total) {
  const start = (currentPage - 1) * perPage
  return Array.from(
    { length: Math.min(perPage, total - start) },
    (_, index) => ({
      id: start + index + 1,
      title: `Durable course ${start + index + 1}`,
      status: 'published'
    })
  )
}

function assertResourceQuery(expect, url, filters) {
  expect(url.searchParams.get('perPage')).toBe('5')
  expect(url.searchParams.get('search')).toBe('Durable')
  expect(url.searchParams.get('sort')).toBe('title DESC')
  expect(url.searchParams.get('filters')).toBe(filters)
  expect(url.searchParams.get('lens')).toBe('recent')
  expect(url.searchParams.get('dashboard')).toBe('operators')
}
