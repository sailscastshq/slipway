const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { Sails } = require('sails')
const Native = require('better-sqlite3')
const migrations = require('../../api/lib/release-migrations')
const consoleConfig = require('../../config/env/console')
const ensure = require('../../api/helpers/wake/ensure-schema')
const maintenance = require('../../scripts/maintain-wake')

for (const environment of ['console', 'production']) {
  test(
    `${environment} load applies session ownership without bootstrap`,
    { timeout: 10000 },
    async () => {
      const directory = fs.mkdtempSync(
        path.join(os.tmpdir(), 'slipway-console-load-')
      )
      const app = new Sails()
      let stores = 0,
        bootstraps = 0
      try {
        await new Promise((resolve, reject) =>
          app.load(
            {
              appPath: directory,
              environment,
              globals: false,
              log: { level: 'silent' },
              hookTimeout: 3000,
              hooks: {
                ...(environment === 'console' ? consoleConfig.hooks : {}),
                orm: false,
                grunt: false,
                sockets: false
              },
              bootstrap: () => {
                bootstraps++
              },
              session: {
                secret: 'disposable-fixture-only',
                adapter: () => {},
                handleConstructingSessionStore: () => {
                  stores++
                  return new (require('express-session').Store)()
                }
              }
            },
            (error) => (error ? reject(error) : resolve())
          )
        )
        assert.equal(bootstraps, 0)
        assert.equal(Boolean(app.hooks.session), environment === 'production')
        assert.equal(stores, environment === 'production' ? 1 : 0)
        assert.equal(app.wakeStorageReady, undefined)
      } finally {
        await new Promise((resolve) => app.lower(resolve))
        fs.rmSync(directory, { recursive: true, force: true })
      }
    }
  )
}

async function worker(callback) {
  const directory = fs.mkdtempSync(
    path.join(os.tmpdir(), 'slipway-wake-worker-')
  )
  const previous = {
    sails: global.sails,
    App: global.App,
    marker: process.env.SLIPWAY_RELEASE_SCHEMA_REQUIRED
  }
  let db
  try {
    await migrations.run({ directory })
    const datastores = Object.fromEntries(
      Object.entries(migrations.files).map(([name, file]) => [
        name,
        { adapter: 'sails-sqlite', url: path.join(directory, file) }
      ])
    )
    db = new Native(datastores.analytics.url)
    process.env.SLIPWAY_RELEASE_SCHEMA_REQUIRED = '1'
    let ddl = 0
    global.sails = {
      config: { environment: 'console', datastores },
      getDatastore: () => ({
        manager: db,
        sendNativeQuery: async () => {
          ddl++
          throw Error('Production worker must not run DDL')
        }
      }),
      helpers: { wake: { ensureSchema: () => ensure.fn() } }
    }
    global.App = { find: () => ({ select: async () => [{ id: 'live' }] }) }
    await callback(db, () => ddl, datastores)
  } finally {
    db?.close()
    global.sails = previous.sails
    global.App = previous.App
    if (previous.marker === undefined)
      delete process.env.SLIPWAY_RELEASE_SCHEMA_REQUIRED
    else process.env.SLIPWAY_RELEASE_SCHEMA_REQUIRED = previous.marker
    fs.rmSync(directory, { recursive: true, force: true })
  }
}

test('fresh production-origin worker validates schema and performs bounded maintenance without bootstrap DDL', () =>
  worker(async (db, ddl) => {
    db.prepare('INSERT INTO wake_health(app,received) VALUES(?,?)').run(
      'live',
      1
    )
    db.prepare('INSERT INTO wake_health(app,received) VALUES(?,?)').run(
      'deleted',
      1
    )
    db.prepare('INSERT INTO wake_runtime_stats VALUES(?,?,?,?,?,?)').run(
      'live',
      'expired',
      0,
      0,
      0,
      0
    )
    assert.equal(sails.wakeStorageReady, undefined)
    await maintenance.fn()
    assert.equal(sails.wakeStorageReady, true)
    assert.equal(
      db.prepare('SELECT COUNT(*) n FROM wake_runtime_stats').get().n,
      0
    )
    assert.deepEqual(db.prepare('SELECT app FROM wake_health').all(), [
      { app: 'live' }
    ])
    await maintenance.fn()
    assert.equal(ddl(), 0)
  }))

test('fallback worker fails visibly without deleting retained data', () =>
  worker(async (db) => {
    db.prepare('INSERT INTO wake_health(app,received) VALUES(?,?)').run(
      'deleted',
      1
    )
    sails.wakeStorageFallback = true
    await assert.rejects(maintenance.fn(), /persistent storage is unavailable/)
    assert.equal(sails.wakeStorageReady, false)
    assert.equal(db.prepare('SELECT COUNT(*) n FROM wake_health').get().n, 1)
  }))

test('invalid release catalog fails closed before maintenance or development DDL', () =>
  worker(async (db, ddl) => {
    db.exec('DROP TABLE wake_runtime_stats')
    db.prepare('INSERT INTO wake_health(app,received) VALUES(?,?)').run(
      'deleted',
      1
    )
    await assert.rejects(maintenance.fn(), /recorded release schema changed/)
    assert.equal(sails.wakeStorageReady, false)
    assert.equal(db.prepare('SELECT COUNT(*) n FROM wake_health').get().n, 1)
    assert.equal(ddl(), 0)
  }))

test('missing release receipt fails closed without creating schema', () =>
  worker(async (db, ddl) => {
    db.exec('DELETE FROM _slipway_release_migrations')
    await assert.rejects(maintenance.fn(), /release schema is not ready/)
    assert.equal(sails.wakeStorageReady, false)
    assert.equal(ddl(), 0)
  }))
