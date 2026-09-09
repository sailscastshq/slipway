const { test } = require('sounding')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')

test(
  'Dock distinguishes verified, pending, and unverified schema comparisons',
  {
    browser: true,
    world: {
      name: 'configured-slipway',
      context: { deploymentTarget: { slug: 'schema-comparison' } }
    }
  },
  async ({ sails, world, login, page, expect }) => {
    const root = fs.mkdtempSync(
      path.join(os.tmpdir(), 'slipway-schema-comparison-')
    )
    const Database = require('better-sqlite3')
    const filename = path.join(root, 'schema.db')
    const db = new Database(filename)
    db.exec(
      'CREATE TABLE people (id INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL, email TEXT);'
    )
    const models = {
      person: {
        tableName: 'people',
        primaryKey: 'id',
        attributes: {
          id: { type: 'number', autoIncrement: true },
          email: { type: 'string' }
        }
      }
    }
    const schema = await sails.helpers.dock.getSchema({
      type: 'sqlite',
      path: filename
    })
    let payload
    async function compare() {
      const diff = await sails.helpers.dock.generateDiff(
        models,
        schema.tables,
        'postgresql'
      )
      const { statements } = await sails.helpers.dock.generateMigrationSql(
        diff,
        'postgresql',
        models,
        schema.tables
      )
      payload = {
        diff,
        statements: statements.map((statement, index) => ({
          ...statement,
          operationId: `operation-${index}`
        })),
        plan:
          diff.state === 'changes_pending'
            ? {
                id: 'reviewed-plan',
                hash: 'reviewed-hash',
                expiresAt: Date.now() + 300000
              }
            : null,
        state: diff.state,
        verification: { unsupported: diff.unsupported },
        hasPendingChanges: statements.length > 0,
        hasBlockedChanges: statements.some((item) => item.blocked),
        modelsSource: 'runtime'
      }
    }
    await compare()
    try {
      const current = world.current
      const database = await world.create('service').with({
        name: 'primary-db',
        type: 'postgresql',
        version: '17',
        status: 'running',
        environment: current.environments.production.id,
        database: 'app'
      })
      await page.raw.route('**/dock/tables?**', (route) =>
        route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ tables: [] })
        })
      )
      let submitted
      await page.raw.route('**/dock/migrate?**', (route) => {
        submitted = route.request().postDataJSON()
        return route.fulfill({
          status: 400,
          contentType: 'application/json',
          body: JSON.stringify({
            success: false,
            error:
              'The app or database changed after this preview. Refresh and review a new migration plan.'
          })
        })
      })
      await page.raw.route('**/dock/diff?**', (route) =>
        route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify(payload)
        })
      )
      await login.withPassword('genesisUser', page, {
        password: current.auth.genesisUserPassword
      })
      await page.raw.waitForURL('**/')
      await page.goto(
        `/projects/schema-comparison/environments/production/dock/${database.id}?tab=migrate`
      )
      const output = path.resolve('output/issue-372')
      fs.mkdirSync(output, { recursive: true })
      for (const state of ['up_to_date', 'changes_pending', 'unverified']) {
        if (state === 'changes_pending')
          models.person.attributes.email.unique = true
        if (state === 'unverified')
          models.person.attributes.id.autoIncrement = false
        await compare()
        expect(payload.state).toBe(state)
        if (state === 'changes_pending')
          payload.preflight = { verified: true, affectedRows: { people: 1 } }
        await page.raw
          .getByRole('button', { name: 'Refresh', exact: true })
          .click()
        if (state === 'up_to_date')
          await expect(
            page.raw.getByText('Schema is up to date', { exact: true })
          ).toBeVisible()
        if (state === 'changes_pending')
          await expect(
            page.raw.getByRole('button', { name: 'Apply', exact: true })
          ).toBeEnabled()
        if (state === 'changes_pending')
          await expect(
            page.raw
              .getByRole('status')
              .filter({ hasText: 'Preview validated' })
          ).toHaveAttribute('data-slot', 'alert')
        if (state === 'unverified') {
          const alert = page.raw
            .getByRole('alert')
            .filter({ hasText: 'Schema needs review' })
          await expect(alert).toHaveAttribute('data-slot', 'alert')
          await expect(alert).toBeVisible()
          await expect(
            page.raw.getByRole('button', { name: 'Apply', exact: true })
          ).toBeDisabled()
          expect(
            await page.raw
              .getByText('Schema is up to date', { exact: true })
              .count()
          ).toBe(0)
        }
        for (const [width, colorScheme] of [
          [1280, 'light'],
          [390, 'dark']
        ]) {
          await page.raw.setViewportSize({ width, height: 850 })
          await page.raw.emulateMedia({ colorScheme })
          expect(
            await page.raw.evaluate(
              () => document.documentElement.scrollWidth <= window.innerWidth
            )
          ).toBe(true)
          await page.screenshot(path.join(output, `${state}-${width}.png`), {
            animations: 'disabled'
          })
        }
        if (state === 'changes_pending') {
          await page.raw
            .getByRole('button', { name: 'Apply', exact: true })
            .click()
          const dialog = page.raw.getByRole('dialog')
          await expect(dialog).toBeVisible()
          expect(await dialog.getByRole('button').count()).toBe(2)
          await dialog
            .getByRole('button', { name: 'Apply', exact: true })
            .click()
          const alert = page.raw
            .getByRole('alert')
            .filter({ hasText: 'changed after this preview' })
          await expect(alert).toHaveAttribute('data-slot', 'alert')
          await expect(alert).toBeVisible()
          await expect(dialog).toBeHidden()
          expect(submitted.planId).toBe('reviewed-plan')
          expect(submitted.planHash).toBe('reviewed-hash')
          expect(submitted.operationIds.length > 0).toBe(true)
          expect(submitted.statements).toBe(undefined)
          await expect(
            page.raw.getByRole('button', { name: 'Apply', exact: true })
          ).toBeDisabled()
          await page.screenshot(path.join(output, 'stale-plan-390.png'), {
            animations: 'disabled'
          })
        }
      }
    } finally {
      db.close()
      fs.rmSync(root, { recursive: true, force: true })
    }
  }
)
