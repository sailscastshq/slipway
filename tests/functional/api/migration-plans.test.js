const { test } = require('sounding')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const Database = require('better-sqlite3')
const { withCsrfFromPage } = require('../../support/csrf-request')

test(
  'Bosun accepts only current server plans and rolls back failed or unverifiable multi-operation migrations',
  { world: { name: 'configured-slipway' } },
  async ({ sails, request, expect }) => {
    const directory = fs.mkdtempSync(
      path.join(os.tmpdir(), 'slipway-plan-api-')
    )
    const filename = path.join(directory, 'fixture.db')
    const db = new Database(filename)
    const originals = {
      service: sails.helpers.bosun.getDatabaseService,
      models: sails.helpers.bosun.getModels,
      diff: sails.helpers.dock.generateDiff
    }
    const model = {
      thing: {
        tableName: 'things',
        primaryKey: 'id',
        attributes: {
          id: { type: 'number', autoIncrement: true },
          title: { type: 'string', unique: true },
          note: { type: 'string' }
        }
      }
    }
    const service = { type: 'sqlite', path: filename, datastore: 'fixture' }
    sails.helpers.bosun.getDatabaseService = async () => service
    sails.helpers.bosun.getModels = async () => ({
      models: model,
      modelCount: 1,
      datastore: 'fixture'
    })
    function reset(duplicates = false) {
      db.exec(
        "DROP TABLE IF EXISTS things; CREATE TABLE things (id INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL, title TEXT); INSERT INTO things(title) VALUES ('same');"
      )
      if (duplicates) db.exec("INSERT INTO things(title) VALUES ('same')")
    }
    try {
      reset()
      const browser = await withCsrfFromPage(request, '/', 'genesisUser')
      const preview = async () => {
        const response = await browser.request.get(
          '/api/v1/bosun/diff?database=app'
        )
        expect(response).toHaveStatus(200)
        expect(Boolean(response.data.plan?.id)).toBe(true)
        return response.data
      }
      const body = (data) => ({
        database: 'app',
        planId: data.plan.id,
        planHash: data.plan.hash,
        operationIds: data.statements.map((item) => item.operationId)
      })
      expect(
        await browser.request.post('/api/v1/bosun/migrate', {
          statements: ['DROP TABLE things']
        })
      ).toHaveStatus(400)
      const stale = await preview()
      db.exec('ALTER TABLE things ADD COLUMN external_change TEXT')
      const rejected = await browser.request.post(
        '/api/v1/bosun/migrate',
        body(stale)
      )
      expect(rejected.data.success).toBe(false)
      expect(rejected.data.code).toBe('staleMigrationPlan')
      expect(
        db
          .prepare('PRAGMA table_info(things)')
          .all()
          .some((column) => column.name === 'note')
      ).toBe(false)
      const current = await preview()
      const applied = await browser.request.post(
        '/api/v1/bosun/migrate',
        body(current)
      )
      expect(applied.data.success).toBe(true)
      expect(applied.data.verified).toBe(true)
      expect(db.prepare('SELECT title FROM things').all()).toEqual([
        { title: 'same' }
      ])
      expect(
        await browser.request.post('/api/v1/bosun/migrate', body(current))
      ).toHaveStatus(400)
      const events = await sails.models.auditlog.find({
        resourceId: current.plan.id
      })
      expect(events.some((event) => event.action === 'migration.applied')).toBe(
        true
      )
      expect(
        events.find((event) => event.action === 'migration.reviewed').details
          .archive.algorithm
      ).toBe('aes-256-gcm')
      expect(JSON.stringify(events).includes('CREATE UNIQUE INDEX')).toBe(false)

      reset(true)
      const failing = await preview()
      const failure = await browser.request.post(
        '/api/v1/bosun/migrate',
        body(failing)
      )
      expect(failure.data.success).toBe(false)
      expect(failure.data.outcome).toBe('rolledBack')
      expect(
        db
          .prepare('PRAGMA table_info(things)')
          .all()
          .some((column) => column.name === 'note')
      ).toBe(false)
      expect(
        db.prepare('SELECT COUNT(*) AS count FROM things').get().count
      ).toBe(2)

      reset()
      const unverifiable = await preview()
      sails.helpers.dock.generateDiff = async (models, schema, type) => {
        const result = await originals.diff(models, schema, type)
        if (schema.things.columns.some((column) => column.name === 'note'))
          result.state = 'unverified'
        return result
      }
      const mismatch = await browser.request.post(
        '/api/v1/bosun/migrate',
        body(unverifiable)
      )
      expect(mismatch.data.success).toBe(false)
      expect(mismatch.data.code).toBe('migrationPostflightMismatch')
      expect(
        db
          .prepare('PRAGMA table_info(things)')
          .all()
          .some((column) => column.name === 'note')
      ).toBe(false)
      sails.helpers.dock.generateDiff = originals.diff
      delete model.thing.attributes.note
      db.exec(
        'DROP TABLE things; CREATE TABLE things (id INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL, title INTEGER); INSERT INTO things(title) VALUES (42)'
      )
      service.datastore = 'default'
      db.exec(
        'CREATE TABLE audit_logs (action TEXT, resource_type TEXT, resource_id TEXT, user INTEGER, team INTEGER, details TEXT, created_at INTEGER, updated_at INTEGER)'
      )
      const rebuild = await preview()
      const rebuilt = await browser.request.post(
        '/api/v1/bosun/migrate',
        body(rebuild)
      )
      expect(rebuilt.data.success).toBe(true)
      expect(
        db
          .prepare(
            "SELECT COUNT(*) AS count FROM audit_logs WHERE action = 'migration.verified'"
          )
          .get().count
      ).toBe(1)
      expect(db.prepare('SELECT title FROM things').get().title).toBe('42')
      const event = await sails.models.auditlog.findOne({
        resourceId: rebuild.plan.id,
        action: 'migration.applied'
      })
      expect(event.details.backup.verified).toBe(true)
      expect(fs.statSync(event.details.backup.path).mode & 0o777).toBe(0o600)
      const recovery = new Database(event.details.backup.path, {
        readonly: true
      })
      expect(recovery.prepare('SELECT title FROM things').get().title).toBe(42)
      recovery.close()
    } finally {
      sails.helpers.bosun.getDatabaseService = originals.service
      sails.helpers.bosun.getModels = originals.models
      sails.helpers.dock.generateDiff = originals.diff
      db.close()
      fs.rmSync(directory, { recursive: true, force: true })
    }
  }
)
