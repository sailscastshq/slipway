const { test } = require('sounding')
const fs = require('node:fs')
const path = require('node:path')
const phase = process.env.DOCK_UX_CAPTURE_PHASE || 'after'
test(
  'Dock migration preview has compact readable labels and distinct empty, loading and error states',
  {
    browser: true,
    world: {
      name: 'configured-slipway',
      context: { deploymentTarget: { slug: 'dock-compact-preview' } }
    }
  },
  async ({ world, login, page, expect }) => {
    const current = world.current
    const service = await world.create('service').with({
      name: 'db',
      type: 'postgresql',
      version: '17',
      status: 'running',
      environment: current.environments.production.id,
      database: 'synthetic'
    })
    const models = [
      'invoices',
      'invoice_deliveries',
      'invoice_items',
      'invoice_pdf_artifacts',
      'invoice_templates',
      'receipts',
      'users'
    ]
    let state = 'pending',
      waitForLoad
    const payload = {
      state: 'changes_pending',
      modelsSource: 'runtime',
      modelLabels: {
        invoices: 'invoice',
        invoice_deliveries: 'invoicedelivery',
        invoice_items: 'invoiceitem',
        invoice_pdf_artifacts: 'invoicepdfartifact',
        invoice_templates: 'invoicetemplate',
        receipts: 'receipt',
        users: 'user'
      },
      hasPendingChanges: true,
      hasBlockedChanges: false,
      plan: {
        id: 'synthetic-plan',
        hash: 'synthetic-hash',
        expiresAt: Date.now() + 300000
      },
      preflight: { verified: true, affectedRows: { invoices: 562 } },
      verification: { unsupported: [] },
      diff: {
        columnsToModify: models.map((tableName) => ({
          tableName,
          columnName: 'paid_at',
          current: { type: 'real' },
          expected: { sqlType: 'double precision' }
        }))
      },
      statements: models.map((table, i) => ({
        table,
        type: 'modify_column',
        column: 'paid_at',
        operationId: 'op-' + i,
        sql: `ALTER TABLE "${table}" ALTER COLUMN "paid_at" TYPE double precision;`
      }))
    }
    await page.raw.route('**/dock/tables?**', (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ tables: [] })
      })
    )
    await page.raw.route('**/dock/diff?**', async (route) => {
      if (state === 'loading')
        await new Promise((resolve) => {
          waitForLoad = resolve
        })
      if (state === 'error')
        return route.fulfill({
          status: 500,
          contentType: 'application/json',
          body: JSON.stringify({
            error: 'The deployed schema could not be read. Retry shortly.'
          })
        })
      const body =
        state === 'empty'
          ? {
              ...payload,
              state: 'up_to_date',
              hasPendingChanges: false,
              statements: [],
              preflight: undefined,
              diff: { columnsToModify: [] }
            }
          : payload
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(body)
      })
    })
    await page.raw.addInitScript(() => {
      window.__dockPaints = []
      const recorded = new Set()
      const observe = () =>
        new MutationObserver(() =>
          requestAnimationFrame(() => {
            const label = document.querySelector('[data-value="migrate"] dl dt')
            const resource = performance
              .getEntriesByType('resource')
              .filter((item) => item.name.includes('/dock/diff'))
              .at(-1)
            if (label && resource && !recorded.has(resource.responseEnd)) {
              recorded.add(resource.responseEnd)
              window.__dockPaints.push({
                responseToFrameMs: performance.now() - resource.responseEnd
              })
            }
          })
        ).observe(document.documentElement, { childList: true, subtree: true })
      if (document.documentElement) observe()
      else
        document.addEventListener('DOMContentLoaded', observe, { once: true })
    })
    await login.withPassword('genesisUser', page, {
      password: current.auth.genesisUserPassword
    })
    await page.raw.waitForURL('**/')
    const url = `/projects/dock-compact-preview/environments/production/dock/${service.id}?tab=migrate`
    await page.goto(url)
    const dir = path.resolve('.tmp/screenshots/dock-compact', phase)
    fs.mkdirSync(dir, { recursive: true })
    const evidence = []
    for (const colorScheme of ['light', 'dark']) {
      await page.raw.setViewportSize({ width: 1280, height: 900 })
      await page.raw.emulateMedia({ colorScheme })
      await expect(
        page.raw.getByText('Preview validated', { exact: true })
      ).toBeVisible()
      if (phase === 'after') {
        await expect(
          page.raw.getByText('invoice.paid_at', { exact: true })
        ).toBeVisible()
        await expect(
          page.raw.getByText('invoices.paid_at', { exact: true })
        ).toHaveCount(0)
        await expect(
          page.raw.getByText(
            'ALTER TABLE "invoices" ALTER COLUMN "paid_at" TYPE double precision;',
            { exact: true }
          )
        ).toBeVisible()
      }
      const measurement = await page.raw.evaluate(async () => {
        await new Promise((resolve) =>
          requestAnimationFrame(() => requestAnimationFrame(resolve))
        )
        const label = document.querySelector('[data-value="migrate"] dl dt')
        const canvas = document.createElement('canvas')
        canvas.width = canvas.height = 1
        const context = canvas.getContext('2d')
        const rgb = (color) => {
          context.clearRect(0, 0, 1, 1)
          context.fillStyle = color
          context.fillRect(0, 0, 1, 1)
          return [...context.getImageData(0, 0, 1, 1).data]
        }
        const foreground = rgb(getComputedStyle(label).color)
        let background = [255, 255, 255, 255]
        for (let node = label; node; node = node.parentElement) {
          const color = rgb(getComputedStyle(node).backgroundColor)
          if (color[3] === 255) {
            background = color
            break
          }
        }
        const luminance = (color) =>
          color
            .slice(0, 3)
            .map((channel) => {
              const c = channel / 255
              return c <= 0.04045
                ? c / 12.92
                : Math.pow((c + 0.055) / 1.055, 2.4)
            })
            .reduce((sum, c, i) => sum + c * [0.2126, 0.7152, 0.0722][i], 0)
        const light = luminance(foreground),
          dark = luminance(background)
        return {
          mode: matchMedia('(prefers-color-scheme: dark)').matches
            ? 'dark'
            : 'light',
          foreground,
          background,
          contrast:
            (Math.max(light, dark) + 0.05) / (Math.min(light, dark) + 0.05),
          changeListHeight: label.closest('dl').getBoundingClientRect().height,
          paints: window.__dockPaints
        }
      })
      evidence.push(measurement)
      if (phase === 'after') expect(measurement.contrast >= 4.5).toBe(true)
      await page.screenshot(path.join(dir, `pending-${colorScheme}.png`), {
        fullPage: true,
        animations: 'disabled'
      })
      state = 'empty'
      await page.raw
        .getByRole('button', { name: 'Refresh', exact: true })
        .click()
      await expect(
        page.raw.getByText('Schema is up to date', { exact: true })
      ).toBeVisible()
      evidence.push(
        await page.raw.evaluate(() => {
          const heading = [
            ...document.querySelectorAll('[data-value="migrate"] h3')
          ].find((node) => node.textContent.trim() === 'Schema is up to date')
          return {
            state: 'empty',
            mode: matchMedia('(prefers-color-scheme: dark)').matches
              ? 'dark'
              : 'light',
            height: (
              heading.closest('[data-testid="dock-up-to-date"]') ||
              heading.parentElement
            ).getBoundingClientRect().height
          }
        })
      )
      await page.screenshot(path.join(dir, `empty-${colorScheme}.png`), {
        fullPage: true,
        animations: 'disabled'
      })
      state = 'pending'
      await page.raw
        .getByRole('button', { name: 'Refresh', exact: true })
        .click()
    }
    if (phase === 'after') {
      state = 'empty'
      await page.raw
        .getByRole('button', { name: 'Refresh', exact: true })
        .click()
      await expect(
        page.raw.getByRole('button', { name: 'View schema', exact: true })
      ).toBeVisible()
      await page.raw.route('**/dock/schema?**', (route) =>
        route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ tables: {} })
        })
      )
      await page.raw
        .getByRole('button', { name: 'View schema', exact: true })
        .click()
      await page.raw.waitForURL('**tab=schema')
      await expect(
        page.raw.locator('[data-slot="tab-panel"][data-value="schema"]')
      ).toBeVisible()
      state = 'pending'
      await page.raw
        .locator('[data-slot="tabs-list"] [data-value="migrate"]')
        .click()
      await page.raw
        .getByRole('button', { name: 'Refresh', exact: true })
        .click()
      await page.raw.setViewportSize({ width: 390, height: 844 })
      await expect(
        page.raw.getByText('invoice.paid_at', { exact: true })
      ).toBeVisible()
      expect(
        await page.raw.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth
        )
      ).toBe(true)
      await page.screenshot(path.join(dir, 'pending-mobile-dark.png'), {
        fullPage: true,
        animations: 'disabled'
      })
      await page.raw.setViewportSize({ width: 1280, height: 900 })
    }
    state = 'loading'
    await page.raw.getByRole('button', { name: 'Refresh', exact: true }).click()
    await expect(
      page.raw.getByRole('status').filter({ hasText: 'Loading migration diff' })
    ).toBeVisible()
    await expect(
      page.raw.getByText('Schema is up to date', { exact: true })
    ).toHaveCount(0)
    await page.screenshot(path.join(dir, 'loading-dark.png'), {
      fullPage: true,
      animations: 'disabled'
    })
    state = 'error'
    waitForLoad()
    await expect(
      page.raw
        .getByRole('alert')
        .filter({ hasText: 'The deployed schema could not be read.' })
    ).toBeVisible()
    await expect(
      page.raw.getByText('Schema is up to date', { exact: true })
    ).toHaveCount(0)
    await page.screenshot(path.join(dir, 'error-dark.png'), {
      fullPage: true,
      animations: 'disabled'
    })
    fs.writeFileSync(
      path.join(dir, 'geometry.json'),
      JSON.stringify(evidence, null, 2)
    )
  }
)
