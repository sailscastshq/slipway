const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { execFileSync } = require('node:child_process')
const Native = require('better-sqlite3')
const migrations = require('../../api/lib/release-migrations')
const consoleConfig = require('../../config/env/console')
const ensure = require('../../api/helpers/wake/ensure-schema')
const maintenance = require('../../scripts/maintain-wake')

// Exercise CLI -> Whelk -> getRc -> load with env config loaded by Sails.
// Deliberately do not inject the env file as a direct load({hooks}) override.
for (const corrected of [false, true]) {
  test(
    `real sails run retains core session hook with ${
      corrected ? 'corrected' : 'existing'
    } console env key`,
    { timeout: 10000 },
    () => {
      const directory = fs.mkdtempSync(
        path.join(os.tmpdir(), 'slipway-console-cli-')
      )
      try {
        fs.mkdirSync(path.join(directory, 'config/env'), { recursive: true })
        fs.mkdirSync(path.join(directory, 'scripts'))
        fs.symlinkSync(
          path.resolve(__dirname, '../../node_modules'),
          path.join(directory, 'node_modules'),
          'dir'
        )
        fs.writeFileSync(
          path.join(directory, 'package.json'),
          JSON.stringify({
            name: 'disposable-console-worker',
            scripts: {},
            dependencies: { sails: '*' }
          })
        )
        fs.writeFileSync(
          path.join(directory, '.sailsrc'),
          JSON.stringify({
            hooks: { orm: false, grunt: false, sockets: false },
            globals: { sails: true, models: false },
            log: { level: 'silent' }
          })
        )
        const hooks = { ...consoleConfig.hooks }
        if (corrected) {
          delete hooks.sesssion
          hooks.session = false
        }
        fs.writeFileSync(
          path.join(directory, 'config/env/console.js'),
          'module.exports=' + JSON.stringify({ hooks, fixtureConsole: true })
        )
        fs.writeFileSync(
          path.join(directory, 'config/session.js'),
          `module.exports.session={secret:'disposable-fixture-only',adapter:()=>{},handleConstructingSessionStore:()=>{global.fixtureStores=(global.fixtureStores||0)+1;return new (require('express-session').Store)()}}`
        )
        fs.writeFileSync(
          path.join(directory, 'config/bootstrap.js'),
          `module.exports.bootstrap=()=>{throw Error('bootstrap must not run')}`
        )
        fs.writeFileSync(
          path.join(directory, 'scripts/fixture.js'),
          `module.exports={friendlyName:'Disposable fixture',fn:async function(){console.log('FIXTURE:'+JSON.stringify({session:!!this.sails.hooks.session,stores:global.fixtureStores||0,envLoaded:this.sails.config.fixtureConsole===true,ready:this.sails.wakeStorageReady===true}))}}`
        )
        const output = execFileSync(
          process.execPath,
          [require.resolve('sails/bin/sails.js'), 'run', 'fixture'],
          {
            cwd: directory,
            timeout: 8000,
            env: { PATH: process.env.PATH, NODE_ENV: 'console' },
            encoding: 'utf8'
          }
        )
        const result = JSON.parse(output.split('FIXTURE:')[1].split('\n')[0])
        assert.deepEqual(result, {
          session: true,
          stores: 1,
          envLoaded: true,
          ready: false
        })
      } finally {
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
