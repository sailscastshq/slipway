const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const Native = require('better-sqlite3')
let tracking
require.cache[require.resolve('better-sqlite3')].exports = new Proxy(Native, {
  construct(Target, args) {
    const log = tracking
    const observed = log && args[1]?.readonly && args[1]?.fileMustExist
    if (observed && log.handles.length + 1 === log.failAt) throw log.failure
    if (observed) args[1] = { ...args[1], verbose: () => log.statements++ }
    const db = new Target(...args)
    if (observed) {
      log.handles.push(db)
      const close = db.close
      db.close = function () {
        log.closes++
        close.call(this)
        if (log.closeFailure && log.handles[0] === db) throw log.closeFailure
      }
    }
    return db
  }
})
const migrations = require('../../api/lib/release-migrations')
const ready = require('../../api/lib/release-schema-ready')

async function fixture(callback) {
  const directory = fs.mkdtempSync(
    path.join(os.tmpdir(), 'slipway-schema-scope-')
  )
  const previous = tracking
  tracking = undefined
  try {
    await migrations.run({ directory })
    const app = {
      config: {
        environment: 'production',
        datastores: Object.fromEntries(
          Object.entries(migrations.files).map(([name, file]) => [
            name,
            { adapter: 'sails-sqlite', url: path.join(directory, file) }
          ])
        )
      }
    }
    const log = { handles: [], closes: 0, statements: 0 }
    tracking = log
    await callback(app, log, directory)
    assert.ok(
      log.handles.every((db) => !db.open),
      'all successfully opened verification handles are closed'
    )
  } finally {
    tracking = previous
    fs.rmSync(directory, { recursive: true, force: true })
  }
}
function edit(app, callback) {
  const db = new Native(app.config.datastores.default.url)
  try {
    return callback(db)
  } finally {
    db.close()
  }
}

test('scope reuses four handles but repeats full verification, then outside calls own four handles', () =>
  fixture(async (app, log) => {
    await ready.withScope(app, async () => {
      assert.equal(ready(app), true)
      const first = log.statements
      await Promise.resolve()
      assert.ok(log.handles.every((db) => db.open && !db.inTransaction))
      assert.equal(ready(app), true)
      assert.equal(
        log.statements,
        first * 2,
        'no verification statements are cached'
      )
      assert.equal(log.handles.length, 4)
      assert.equal(log.closes, 0)
    })
    assert.equal(log.closes, 4)
    assert.equal(ready(app), true)
    assert.equal(log.handles.length, 8)
    assert.equal(log.closes, 8)
  }))

test('receipt DML failure poisons the scope even when caught and repaired by callback', () =>
  fixture(async (app, log) => {
    let caught
    await assert.rejects(
      ready.withScope(app, async () => {
        ready(app)
        edit(app, (db) =>
          db
            .prepare(`UPDATE ${migrations.receiptTable} SET checksum='bad'`)
            .run()
        )
        try {
          ready(app)
        } catch (error) {
          caught = error
        }
        assert.match(caught.message, /checksum differs/)
        edit(app, (db) =>
          db
            .prepare(`UPDATE ${migrations.receiptTable} SET checksum=?`)
            .run(migrations.checksum)
        )
        assert.throws(
          () => ready(app),
          (error) => error === caught
        )
      }),
      (error) => error === caught
    )
    assert.equal(log.closes, 4)
  }))

test('stale ALS descendants cannot use handles after the awaited callback returns', () =>
  fixture(async (app, log) => {
    let release, descendant
    await ready.withScope(app, async () => {
      ready(app)
      descendant = new Promise((resolve) => {
        release = resolve
      }).then(() => ready(app))
    })
    release()
    await assert.rejects(descendant, /scope is closed/)
    assert.equal(log.handles.length, 4)
    assert.equal(log.closes, 4)
  }))

test('callback rejection and close errors attempt all closes and preserve the original error', () =>
  fixture(async (app, log) => {
    const original = Error('callback failed')
    log.closeFailure = Error('first close failed after closing')
    await assert.rejects(
      ready.withScope(app, async () => {
        ready(app)
        await Promise.resolve()
        throw original
      }),
      (error) => error === original
    )
    assert.equal(log.closes, 4)
  }))

test('cleanup failure rejects an otherwise successful scope after attempting every close', () =>
  fixture(async (app, log) => {
    log.closeFailure = Error('close failure')
    await assert.rejects(
      ready.withScope(app, async () => ready(app)),
      (error) => error === log.closeFailure
    )
    assert.equal(log.closes, 4)
  }))

test('partial creation closes every earlier handle and never enters the callback', () =>
  fixture(async (app, log) => {
    log.failAt = 3
    log.failure = Error('synthetic third open failure')
    log.closeFailure = Error('first partial cleanup close failed')
    let entered = false
    await assert.rejects(
      ready.withScope(app, async () => {
        entered = true
      }),
      (error) => error === log.failure
    )
    assert.equal(entered, false)
    assert.equal(log.handles.length, 2)
    assert.equal(log.closes, 2)
  }))

for (const mutation of [
  'config',
  'url',
  'policy',
  'replace',
  'delete',
  'catalog'
]) {
  test(`${mutation} change cannot silently reuse a verified handle`, () =>
    fixture(async (app, log) => {
      await assert.rejects(
        ready.withScope(app, async () => {
          ready(app)
          const file = app.config.datastores.default.url
          if (mutation === 'config')
            app.config.datastores.default.adapter = 'other'
          if (mutation === 'url')
            app.config.datastores.default.url =
              path.join(path.dirname(file), '.') + '/./' + path.basename(file)
          if (mutation === 'policy') app.config.environment = 'console'
          if (mutation === 'replace') {
            fs.renameSync(file, file + '.old')
            fs.copyFileSync(file + '.old', file)
          }
          if (mutation === 'delete') fs.unlinkSync(file)
          if (mutation === 'catalog')
            edit(app, (db) => db.exec('DROP TABLE cli_tokens'))
          ready(app)
        })
      )
      assert.equal(log.closes, 4)
    }))
}

test('identity is rechecked after full validation, and a caught failure still rejects exit', () =>
  fixture(async (app) => {
    const current = migrations.current
    let changed = false,
      caught
    migrations.current = function (...args) {
      const result = current(...args)
      if (!changed) {
        changed = true
        app.config.datastores.default.url += '.changed'
      }
      return result
    }
    try {
      await assert.rejects(
        ready.withScope(app, async () => {
          try {
            ready(app)
          } catch (error) {
            caught = error
          }
          assert.ok(caught)
        }),
        (error) => error === caught
      )
    } finally {
      migrations.current = current
    }
  }))

test('overlapping scopes and unrelated calls have independent handles and contexts', () =>
  fixture(async (app, log) => {
    let release, entered
    const gate = new Promise((resolve) => {
      release = resolve
    })
    const started = new Promise((resolve) => {
      entered = resolve
    })
    const first = ready.withScope(app, async () => {
      ready(app)
      entered()
      await gate
      ready(app)
    })
    await started
    assert.equal(ready(app), true) // outside the first ALS context
    await ready.withScope(app, async () => {
      ready(app)
      await Promise.resolve()
      ready(app)
    })
    release()
    await first
    assert.equal(log.handles.length, 12)
    assert.equal(log.closes, 12)
  }))

test('scope is bound to its exact Sails instance and caught mismatch poisons exit', () =>
  fixture(async (app) => {
    await assert.rejects(
      ready.withScope(app, async () => {
        assert.throws(
          () => ready({ config: app.config }),
          /another Sails instance/
        )
      }),
      /another Sails instance/
    )
  }))

for (const mode of ['WAL', 'DELETE']) {
  test(`idle verification handles do not block legitimate writes in ${mode} mode`, () =>
    fixture(async (app) => {
      edit(app, (db) => {
        db.pragma('journal_mode=' + mode)
        db.exec('CREATE TABLE fixture_work (id INTEGER PRIMARY KEY)')
      })
      await ready.withScope(app, async () => {
        ready(app)
        edit(app, (db) => db.exec('INSERT INTO fixture_work VALUES(1)'))
        await Promise.resolve()
        edit(app, (db) => db.exec('INSERT INTO fixture_work VALUES(2)'))
        ready(app)
      })
      assert.equal(
        edit(
          app,
          (db) => db.prepare('SELECT count(*) n FROM fixture_work').get().n
        ),
        2
      )
    }))
}

for (const mutation of ['replace', 'delete']) {
  test(`file ${mutation} after catalog validation is detected before guard returns`, () =>
    fixture(async (app) => {
      const current = migrations.current
      let changed = false
      migrations.current = function (...args) {
        const result = current(...args)
        if (!changed) {
          changed = true
          const file = app.config.datastores.default.url
          fs.renameSync(file, file + '.old')
          if (mutation === 'replace') fs.copyFileSync(file + '.old', file)
        }
        return result
      }
      try {
        await assert.rejects(ready.withScope(app, async () => ready(app)))
      } finally {
        migrations.current = current
      }
    }))
}
