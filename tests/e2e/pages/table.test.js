const fs = require('node:fs')
const path = require('node:path')

const { test } = require('sounding')

const capturePhase = process.env.TABLE_SCREENSHOT_PHASE || 'after'
const screenshotRoot = path.resolve(
  `.tmp/screenshots/issue-344-table/${capturePhase}`
)

test(
  'Bosun keeps native query results semantic through Klean Table',
  { browser: true, world: 'configured-slipway' },
  async ({ world, login, page, expect }) => {
    fs.mkdirSync(screenshotRoot, { recursive: true })

    await page.raw.route('**/api/v1/system/check-update', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ updateAvailable: false })
      })
    })
    await page.raw.route('**/api/v1/bosun/helm/completions', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ available: false })
      })
    })
    await page.raw.route('**/api/v1/bosun/sql', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          columns: ['course', 'lessons', 'published', 'revenue'],
          rows: [
            {
              course: 'Durable UI',
              lessons: 18,
              published: true,
              revenue: 245000
            },
            {
              course: 'The Boring JavaScript Stack',
              lessons: 42,
              published: true,
              revenue: 890000
            },
            {
              course: 'Getting started with Sails',
              lessons: 12,
              published: false,
              revenue: null
            }
          ],
          rowCount: 3,
          truncated: false,
          durationMs: 4
        })
      })
    })

    await login.withPassword('genesisUser', page, {
      password: world.current.auth.genesisUserPassword
    })
    await page.resize(1440, 900)
    await page.inLightMode()
    await page.goto('/bosun?tab=console')
    await page.fill(
      '@bosun-sql-editor',
      'SELECT course, lessons, published, revenue FROM course_metrics;'
    )
    await page.click('@bosun-console-run')
    await page.wait('text=Durable UI')

    const table = page.raw.locator('table').filter({ hasText: 'Durable UI' })
    await table.screenshot({
      path: path.join(screenshotRoot, 'bosun-query-table-light.png')
    })
    await page.inDarkMode()
    await page.wait(100)
    await table.screenshot({
      path: path.join(screenshotRoot, 'bosun-query-table-dark.png')
    })

    expect(await table.locator('tbody tr').count()).toBe(3)
    expect(await table.getByRole('columnheader').allTextContents()).toEqual([
      'course',
      'lessons',
      'published',
      'revenue'
    ])

    if (capturePhase === 'after') {
      await expect(table).toHaveAttribute('data-slot', 'table')
      expect((await table.locator('caption').textContent()).trim()).toBe(
        'Bosun SQL query results'
      )
      expect(await table.locator('thead th[scope="col"]').count()).toBe(4)
    }

    expect(page).toHaveNoSmoke()
  }
)
