const { test } = require('sounding')

const successfulQuery = [
  'SELECT count(*) AS creators FROM creators;',
  'SELECT count(*) AS teams FROM teams;'
].join('\n')
const partiallyFailedQuery = [
  'DROP TABLE audit_events;',
  'SELECT * FROM missing_table;'
].join('\n')

test(
  'Dock keeps every SQL result labeled, navigable, and independently copyable',
  {
    browser: true,
    world: {
      name: 'configured-slipway',
      context: {
        deploymentTarget: {
          slug: 'labeled-dock-results',
          name: 'Labeled Dock Results'
        }
      }
    }
  },
  async ({ world, login, page, expect }) => {
    const current = world.current
    const database = await world.create('service').with({
      name: 'primary-db',
      type: 'postgresql',
      version: '17',
      status: 'running',
      environment: current.environments.production.id,
      internalHost: 'primary-db',
      internalPort: 5432,
      database: 'app',
      username: 'slipway',
      password: 'secret'
    })

    await page.raw.route('**/api/v1/system/check-update', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ updateAvailable: false })
      })
    })
    await page.raw.route('**/dock/tables?**', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ tables: [] })
      })
    })
    await page.raw.route('**/dock/sql?**', async (route) => {
      const { query } = route.request().postDataJSON()
      const response = query.includes('missing_table')
        ? partiallyFailedResponse()
        : successfulResponse()

      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(response)
      })
    })

    const updateCheckFinished = page.raw.waitForResponse(
      '**/api/v1/system/check-update'
    )
    await login.withPassword('genesisUser', page, {
      password: current.auth.genesisUserPassword
    })
    await updateCheckFinished
    await page.raw
      .context()
      .grantPermissions(['clipboard-read', 'clipboard-write'])
    await page.resize(1440, 900)
    await page.inLightMode()
    await page.goto(
      `/projects/${current.projects.deploymentTarget.slug}/environments/production/dock/${database.id}`
    )

    await page.fill('@dock-query-editor', successfulQuery)
    await page.raw.getByRole('button', { name: 'Run', exact: true }).click()
    await page.wait('@dock-query-result-1')

    const tabs = page.raw.getByRole('tab')
    expect(await tabs.count()).toBe(2)
    expect(await tabs.nth(0).getAttribute('aria-selected')).toBe('true')
    await expect(page).toSee('24873')
    await page.screenshot('.tmp/issue-213-multi-results-light.png')

    await page.click('@dock-query-result-2')
    await expect(page).toSee('154')
    await page.click('@dock-copy-query-result')
    expect(await page.script(() => navigator.clipboard.readText())).toBe(
      'teams\n154'
    )
    await page.raw
      .getByText('Copied CSV to clipboard')
      .locator('..')
      .getByRole('button')
      .click()
    await page.wait(350)

    await page.raw.getByRole('tab').nth(0).focus()
    await page.key('ArrowRight')
    expect(await tabs.nth(1).getAttribute('aria-selected')).toBe('true')

    await page.inDarkMode()
    await page.fill('@dock-query-editor', partiallyFailedQuery)
    await page.raw.getByRole('button', { name: 'Run', exact: true }).click()
    await page.wait(100)

    expect(await tabs.count()).toBe(2)
    expect(await tabs.nth(1).getAttribute('aria-selected')).toBe('true')
    await expect(page).toSee('relation "missing_table" does not exist')
    await page.screenshot('.tmp/issue-213-partial-failure-dark.png')

    await page.click('@dock-query-result-1')
    await expect(page).toSee('DROP TABLE completed')

    await page.resize(390, 844)
    await page.screenshot('.tmp/issue-213-multi-results-mobile-dark.png')
    expect(page).toHaveNoSmoke()
  }
)

function successfulResponse() {
  const results = [
    queryResult({
      statementIndex: 0,
      statementSql: 'SELECT count(*) AS creators FROM creators;',
      statementPreview: 'SELECT count(*) AS creators FROM creators',
      duration: 2.4,
      columns: ['creators'],
      rows: [{ creators: 24873 }]
    }),
    queryResult({
      statementIndex: 1,
      statementSql: 'SELECT count(*) AS teams FROM teams;',
      statementPreview: 'SELECT count(*) AS teams FROM teams',
      duration: 1.8,
      columns: ['teams'],
      rows: [{ teams: 154 }]
    })
  ]

  return {
    success: true,
    ...results[0],
    duration: 5,
    results,
    messages: ''
  }
}

function partiallyFailedResponse() {
  const results = [
    {
      statementIndex: 0,
      statementSql: 'DROP TABLE audit_events;',
      statementPreview: 'DROP TABLE audit_events',
      commandTag: 'DROP TABLE',
      status: 'success',
      duration: 3.1,
      rowCount: 0,
      affected: null,
      columns: [],
      rows: [],
      message: 'DROP TABLE completed',
      error: null,
      raw: 'DROP TABLE'
    },
    {
      statementIndex: 1,
      statementSql: 'SELECT * FROM missing_table;',
      statementPreview: 'SELECT * FROM missing_table',
      commandTag: 'SELECT',
      status: 'error',
      duration: 1.2,
      rowCount: 0,
      affected: null,
      columns: [],
      rows: [],
      message: 'relation "missing_table" does not exist',
      error: 'relation "missing_table" does not exist',
      sqlState: '42P01',
      raw: ''
    }
  ]

  return {
    success: false,
    ...results[0],
    duration: 5,
    results,
    error: results[1].error,
    messages: 'ERROR: relation "missing_table" does not exist'
  }
}

function queryResult({
  statementIndex,
  statementSql,
  statementPreview,
  duration,
  columns,
  rows
}) {
  return {
    statementIndex,
    statementSql,
    statementPreview,
    commandTag: 'SELECT',
    status: 'success',
    duration,
    rowCount: rows.length,
    affected: null,
    columns,
    rows,
    message: null,
    error: null,
    raw: ''
  }
}
