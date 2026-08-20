const { test } = require('sounding')

const successfulQuery = [
  'SELECT count(*) AS creators FROM creators;',
  'SELECT count(*) AS teams FROM teams;'
].join('\n')
const commandOnlyQuery = [
  'ALTER TABLE invoices ADD COLUMN IF NOT EXISTS recurring_anchor_date VARCHAR(10);',
  'UPDATE invoices SET recurring_anchor_date = next_recurring_date WHERE recurring_enabled = TRUE;',
  'CREATE UNIQUE INDEX IF NOT EXISTS invoices_recurring_occurrence_unique ON invoices (template_invoice, recurring_occurrence_date);'
].join('\n')
const partiallyFailedQuery = [
  'DROP TABLE audit_events;',
  'SELECT * FROM missing_table;'
].join('\n')
const mixedQuery = [
  'SELECT count(*) AS creators FROM creators;',
  'UPDATE missing_table SET active = TRUE;'
].join('\n')

test(
  'Dock presents row, command, failure, and mixed SQL batches clearly',
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
      let response = successfulResponse()

      if (query.includes('ALTER TABLE invoices')) {
        response = commandOnlyResponse()
      } else if (query.includes('UPDATE missing_table')) {
        response = mixedResponse()
      } else if (query.includes('missing_table')) {
        response = partiallyFailedResponse()
      }

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

    await replaceQuery(page, expect, successfulQuery)
    await page.raw.getByRole('button', { name: 'Run', exact: true }).click()
    await page.wait('@dock-query-result-1')

    const resultTable = page.raw.locator(
      '[data-test="dock-query-result-panel"] [data-slot="table"]'
    )
    await expect(resultTable).toBeVisible()
    expect(await resultTable.locator('caption').textContent()).toContain(
      'Query result 1'
    )

    const tabs = page.raw
      .getByRole('tablist', { name: 'Query results' })
      .getByRole('tab')
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

    await tabs.nth(0).focus()
    await page.key('ArrowRight')
    expect(await tabs.nth(1).getAttribute('aria-selected')).toBe('true')

    await replaceQuery(page, expect, commandOnlyQuery)
    await page.raw.getByRole('button', { name: 'Run', exact: true }).click()
    await page.wait('@dock-command-summary')

    expect(await tabs.count()).toBe(0)
    expect(
      await page.raw.locator('[data-test^="dock-command-result-"]').count()
    ).toBe(3)
    await expect(page).toSee('4 rows affected')
    await expect(page).toSee('3 statements completed · 195ms')

    const editorBounds = await page.raw
      .locator('[data-test="dock-query-editor-pane"]')
      .boundingBox()
    const commandResultBounds = await page.raw
      .locator('[data-test="dock-query-results"]')
      .boundingBox()
    expect(commandResultBounds.height < editorBounds.height).toBe(true)
    await page.screenshot('.tmp/issue-293-command-summary-light.png')

    await page.inDarkMode()
    await replaceQuery(page, expect, partiallyFailedQuery)
    await page.raw.getByRole('button', { name: 'Run', exact: true }).click()
    await page.wait('@dock-command-summary')

    expect(await tabs.count()).toBe(0)
    await expect(page).toSee('relation "missing_table" does not exist')
    await expect(page).toSee('1 of 2 statements completed · 1 failed · 5ms')
    await page.screenshot('.tmp/issue-293-partial-failure-dark.png')

    await replaceQuery(page, expect, mixedQuery)
    await page.raw.getByRole('button', { name: 'Run', exact: true }).click()
    await page.wait('@dock-query-result-1')

    expect(await tabs.count()).toBe(2)
    expect(await tabs.nth(1).getAttribute('aria-selected')).toBe('true')
    await expect(page).toSee('Statement failed')
    await expect(page).not.toSee('@dock-copy-query-result')

    await page.click('@dock-query-result-1')
    await expect(page).toSee('24873')
    await page.wait('@dock-copy-query-result')

    await page.resize(390, 844)
    await page.screenshot('.tmp/issue-293-mixed-results-mobile-dark.png')
    expect(page).toHaveNoSmoke()
  }
)

async function replaceQuery(page, expect, value) {
  const editor = page.raw.locator('[data-test="dock-query-editor"]')

  await editor.click()
  await editor.press('ControlOrMeta+A')
  await page.raw.keyboard.insertText(value)

  expect(await editor.innerText()).toBe(value)
}

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

function commandOnlyResponse() {
  const results = [
    commandResult({
      statementIndex: 0,
      statementSql:
        'ALTER TABLE invoices ADD COLUMN IF NOT EXISTS recurring_anchor_date VARCHAR(10);',
      statementPreview:
        'ALTER TABLE invoices ADD COLUMN IF NOT EXISTS recurring_anchor_date VARCHAR(10)',
      commandTag: 'ALTER TABLE',
      duration: 82
    }),
    commandResult({
      statementIndex: 1,
      statementSql:
        'UPDATE invoices SET recurring_anchor_date = next_recurring_date WHERE recurring_enabled = TRUE;',
      statementPreview:
        'UPDATE invoices SET recurring_anchor_date = next_recurring_date WHERE recurring_enabled = TRUE',
      commandTag: 'UPDATE',
      duration: 61,
      affected: 4
    }),
    commandResult({
      statementIndex: 2,
      statementSql:
        'CREATE UNIQUE INDEX IF NOT EXISTS invoices_recurring_occurrence_unique ON invoices (template_invoice, recurring_occurrence_date);',
      statementPreview:
        'CREATE UNIQUE INDEX IF NOT EXISTS invoices_recurring_occurrence_unique ON invoices (template_invoice, recurring_occurrence_date)',
      commandTag: 'CREATE INDEX',
      duration: 52
    })
  ]

  return {
    success: true,
    ...results[0],
    duration: 195,
    results,
    messages: ''
  }
}

function mixedResponse() {
  const results = [
    queryResult({
      statementIndex: 0,
      statementSql: 'SELECT count(*) AS creators FROM creators;',
      statementPreview: 'SELECT count(*) AS creators FROM creators',
      duration: 2.4,
      columns: ['creators'],
      rows: [{ creators: 24873 }]
    }),
    {
      statementIndex: 1,
      statementSql: 'UPDATE missing_table SET active = TRUE;',
      statementPreview: 'UPDATE missing_table SET active = TRUE',
      commandTag: 'UPDATE',
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
    duration: 4,
    results,
    error: results[1].error,
    messages: 'ERROR: relation "missing_table" does not exist'
  }
}

function commandResult({
  statementIndex,
  statementSql,
  statementPreview,
  commandTag,
  duration,
  affected = null
}) {
  return {
    statementIndex,
    statementSql,
    statementPreview,
    commandTag,
    status: 'success',
    duration,
    rowCount: 0,
    affected,
    columns: [],
    rows: [],
    message: null,
    error: null,
    raw: commandTag
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
