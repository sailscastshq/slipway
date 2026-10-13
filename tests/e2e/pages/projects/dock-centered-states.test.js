const { test } = require('sounding')
const fs = require('node:fs')
const path = require('node:path')

test(
  'Dock schema states stay centered, quiet and actionable across themes and screen sizes',
  {
    browser: true,
    world: {
      name: 'configured-slipway',
      context: { deploymentTarget: { slug: 'dock-centered-states' } }
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
    const output =
      process.env.DOCK_STATE_SCREENSHOTS ||
      path.resolve('.tmp/screenshots/dock-centered-states')
    fs.mkdirSync(output, { recursive: true })
    let state = 'empty',
      releaseLoading
    const payload = {
      state: 'up_to_date',
      modelsSource: 'runtime',
      hasPendingChanges: false,
      hasBlockedChanges: false,
      statements: [],
      diff: {},
      verification: { unsupported: [] }
    }
    await page.raw.route('**/dock/tables?**', (route) =>
      route.fulfill({ json: { tables: [] } })
    )
    await page.raw.route('**/dock/diff?**', async (route) => {
      if (state === 'loading')
        await new Promise((resolve) => {
          releaseLoading = resolve
        })
      if (state === 'error')
        return route.fulfill({
          status: 500,
          json: {
            error: 'The deployed schema could not be read. Retry shortly.'
          }
        })
      if (state === 'warning')
        return route.fulfill({
          json: {
            ...payload,
            state: 'unverified',
            hasPendingChanges: true,
            hasBlockedChanges: true,
            verification: {
              unsupported: [
                {
                  tableName: 'notes',
                  columnName: 'created_at',
                  reason:
                    'Changing this type may lose data; reviewed maintenance is required.'
                }
              ]
            }
          }
        })
      return route.fulfill({
        json:
          state === 'pending'
            ? {
                ...payload,
                state: 'changes_pending',
                hasPendingChanges: true,
                plan: {
                  id: 'synthetic-plan',
                  hash: 'synthetic-hash',
                  expiresAt: Date.now() + 300000
                },
                diff: {
                  columnsToAdd: [
                    { tableName: 'notes', columnName: 'note', nullable: true }
                  ]
                },
                statements: [
                  {
                    type: 'add_column',
                    table: 'notes',
                    column: 'note',
                    operationId: 'synthetic-add-note',
                    sql: 'ALTER TABLE "notes" ADD COLUMN "note" TEXT;'
                  }
                ]
              }
            : payload
      })
    })
    await page.raw.route('**/dock/migrate**', async (route) => {
      const input = route.request().postDataJSON()
      expect(input.operationIds).toEqual(['synthetic-add-note'])
      expect(Object.hasOwn(input, 'sql')).toBe(false)
      state = 'empty'
      await route.fulfill({ json: { success: true, executed: 1 } })
    })
    await login.withPassword('genesisUser', page, {
      password: current.auth.genesisUserPassword
    })
    await page.raw.waitForURL('**/')
    await page.goto(
      `/projects/dock-centered-states/environments/production/dock/${service.id}?tab=migrate`
    )
    const refresh = () =>
      page.raw.getByRole('button', { name: 'Refresh', exact: true }).click()
    const evidence = []
    for (const viewport of [
      { name: 'desktop', width: 1280, height: 900 },
      { name: 'mobile', width: 390, height: 844 }
    ]) {
      await page.raw.setViewportSize({
        width: viewport.width,
        height: viewport.height
      })
      for (const colorScheme of ['light', 'dark']) {
        await page.raw.emulateMedia({
          colorScheme,
          reducedMotion: 'no-preference'
        })
        const capture = async (name, title, role = 'status') => {
          const panel = page.raw.getByRole(role).filter({
            has: page.raw.getByRole('heading', { name: title, exact: true })
          })
          await expect(panel).toBeVisible()
          const expectedToken =
            name === 'loading'
              ? 'text-amber-600 dark:text-amber-400'
              : name === 'error'
              ? 'text-red-500 dark:text-red-400'
              : 'text-green-500 dark:text-green-400'
          const geometry = await panel.evaluate((node, token) => {
            const style = getComputedStyle(node)
            const icon = node.querySelector('svg')
            const rect = node.getBoundingClientRect()
            const iconRect = icon.getBoundingClientRect()
            const probe = document.createElement('span')
            probe.className = token
            node.appendChild(probe)
            const expectedColor = getComputedStyle(probe).color
            probe.remove()
            return {
              height: rect.height,
              iconColor: getComputedStyle(icon).color,
              titleColor: getComputedStyle(node.querySelector('h3')).color,
              descriptionColor: getComputedStyle(node.querySelector('p')).color,
              expectedColor,
              textAlign: style.textAlign,
              borderTop: style.borderTopWidth,
              borderBottom: style.borderBottomWidth,
              centerDelta: Math.abs(
                iconRect.x + iconRect.width / 2 - rect.x - rect.width / 2
              ),
              bob: getComputedStyle(icon).animationName,
              blink: getComputedStyle(icon.querySelector('.slippy-wink'))
                .animationName,
              overflow: document.documentElement.scrollWidth > innerWidth
            }
          }, expectedToken)
          expect(geometry.iconColor).toBe(geometry.expectedColor)
          expect(geometry.titleColor).toBe(geometry.expectedColor)
          expect(geometry.descriptionColor === geometry.expectedColor).toBe(
            false
          )
          expect(geometry.height <= 300).toBe(true)
          expect(geometry.textAlign).toBe('center')
          expect(geometry.borderTop).toBe('0px')
          expect(geometry.borderBottom).toBe('0px')
          expect(geometry.centerDelta < 2).toBe(true)
          expect(geometry.bob).toBe('slippy-quiet-bob')
          expect(geometry.blink).toBe('none')
          expect(geometry.overflow).toBe(false)
          evidence.push({
            viewport: viewport.name,
            colorScheme,
            state: name,
            ...geometry
          })
          await page.screenshot(
            path.join(output, `${name}-${viewport.name}-${colorScheme}.png`),
            { fullPage: true, animations: 'disabled' }
          )
        }
        state = 'empty'
        await refresh()
        await capture('empty', 'Schema is up to date')
        await expect(
          page.raw.getByRole('button', { name: 'View schema', exact: true })
        ).toBeVisible()
        state = 'loading'
        await refresh()
        try {
          await capture('loading', 'Loading migration diff')
        } finally {
          state = 'error'
          if (releaseLoading) releaseLoading()
        }
        await capture('error', 'Could not load schema diff', 'alert')
        await expect(
          page.raw.getByText(
            'The deployed schema could not be read. Retry shortly.',
            { exact: true }
          )
        ).toBeVisible()
        state = 'pending'
        await page.raw
          .getByRole('button', { name: 'Try again', exact: true })
          .click()
        await page.raw
          .getByRole('button', { name: 'Apply', exact: true })
          .click()
        await page.raw
          .getByRole('dialog')
          .getByRole('button', { name: 'Apply', exact: true })
          .click()
        await capture('success', 'Migration applied')
        await page.raw
          .getByRole('button', { name: /^Dismiss Migration applied:/ })
          .click()
        await expect(
          page.raw.getByRole('button', { name: /^Dismiss Migration applied:/ })
        ).toHaveCount(0)
      }
    }
    state = 'warning'
    await refresh()
    await expect(
      page.raw.getByRole('alert').filter({ hasText: 'Schema needs review' })
    ).toBeVisible()
    await expect(
      page.raw.getByText(/Changing this type may lose data/)
    ).toBeVisible()
    state = 'empty'
    await refresh()
    await page.raw.emulateMedia({ reducedMotion: 'reduce' })
    await expect(
      page.raw.getByRole('heading', {
        name: 'Schema is up to date',
        exact: true
      })
    ).toBeVisible()
    expect(
      await page.raw
        .locator('[data-testid="dock-up-to-date"] svg')
        .evaluate((icon) => getComputedStyle(icon).animationName)
    ).toBe('none')
    fs.writeFileSync(
      path.join(output, 'geometry.json'),
      JSON.stringify(evidence, null, 2)
    )
    expect(page).toHaveNoJavascriptErrors()
  }
)
