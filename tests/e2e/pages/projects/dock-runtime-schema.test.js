const { test } = require('sounding')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')

test(
  'Dock opens Migrate for a deployed app through the real schema helper and renders readable retry errors',
  {
    browser: true,
    world: {
      name: 'configured-slipway',
      context: { deploymentTarget: { slug: 'runtime-schema' } }
    }
  },
  async ({ sails, world, login, page, expect, request }) => {
    const root = fs.mkdtempSync(
      path.join(os.tmpdir(), 'slipway-runtime-schema-')
    )
    const binary = path.join(root, 'docker')
    const calls = path.join(root, 'calls.jsonl')
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
    fs.writeFileSync(
      binary,
      `#!${process.execPath}\nconst fs = require('node:fs');
const args = process.argv.slice(2);
fs.appendFileSync(${JSON.stringify(calls)}, JSON.stringify(args) + '\\n');
if (args[0] === 'inspect') process.stdout.write(JSON.stringify([{State:{Running:true},Image:'sha256:fixture',Config:{Env:[]}}]));
else if (args[0] === 'exec') { process.stdin.resume(); process.stdin.on('end', () => process.stdout.write(${JSON.stringify(
        JSON.stringify(models)
      )})); }
else process.exit(1);
`,
      { mode: 0o755 }
    )
    const Database = require('better-sqlite3')
    const filename = path.join(root, 'schema.db')
    const db = new Database(filename)
    db.exec(
      'CREATE TABLE people (id INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL, email TEXT);'
    )
    db.close()
    const schema = await sails.helpers.dock.getSchema({
      type: 'sqlite',
      path: filename
    })
    const originalSchema = sails.helpers.dock.getSchema
    const originalDocker = sails.config.docker
    sails.config.docker = { ...originalDocker, binaryPath: binary }
    sails.helpers.dock.getSchema = async () => schema
    try {
      const current = world.current
      await sails.models.app
        .updateOne({ id: current.apps.web.id })
        .set({ containerName: 'runtime-app', status: 'running' })
      const database = await world.create('service').with({
        name: 'primary-db',
        type: 'postgresql',
        version: '17',
        status: 'running',
        environment: current.environments.production.id,
        database: 'app'
      })
      const response = await request
        .as('genesisUser')
        .get('/api/v1/projects/runtime-schema/dock/models')
      expect(response).toHaveStatus(200)
      expect(response).toHaveJsonPath('authoritative', true)
      await page.raw.route('**/dock/tables?**', (route) =>
        route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ tables: [] })
        })
      )
      await login.withPassword('genesisUser', page, {
        password: current.auth.genesisUserPassword
      })
      await page.raw.waitForURL('**/')
      await page.goto(
        `/projects/runtime-schema/environments/production/dock/${database.id}?tab=migrate`
      )
      await expect(
        page.raw.getByText('Schema is up to date', { exact: true })
      ).toBeVisible()
      const args = fs
        .readFileSync(calls, 'utf8')
        .trim()
        .split('\n')
        .map(JSON.parse)
      expect(
        args.some((call) => call[0] === 'inspect' && call[1] === 'runtime-app')
      ).toBe(true)
      expect(
        args.some((call) => call[0] === 'exec' && call[2] === 'runtime-app')
      ).toBe(true)
      const output = path.resolve('output/issue-544')
      fs.mkdirSync(output, { recursive: true })
      await page.raw.emulateMedia({ colorScheme: 'dark' })
      await page.screenshot(path.join(output, 'migrate-working.png'), {
        animations: 'disabled'
      })
      await page.raw.route('**/dock/diff?**', (route) =>
        route.fulfill({
          status: 500,
          contentType: 'application/json',
          body: JSON.stringify({
            error: {
              status: 500,
              title: 'Server error',
              message: 'Could not load the schema. Try again.'
            }
          })
        })
      )
      await page.raw
        .getByRole('button', { name: 'Refresh', exact: true })
        .click()
      const alert = page.raw
        .getByRole('alert')
        .filter({ hasText: 'Could not load the schema. Try again.' })
      await expect(alert).toBeVisible()
      expect((await alert.textContent()).includes('"status"')).toBe(false)
      await page.raw.unroute('**/dock/diff?**')
      await page.raw
        .getByRole('button', { name: 'Try again', exact: true })
        .click()
      await expect(
        page.raw.getByText('Schema is up to date', { exact: true })
      ).toBeVisible()
      expect(page).toHaveNoJavascriptErrors()
    } finally {
      sails.helpers.dock.getSchema = originalSchema
      sails.config.docker = originalDocker
      fs.rmSync(root, { recursive: true, force: true })
    }
  }
)
