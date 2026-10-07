const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const crypto = require('node:crypto')
const Database = require('better-sqlite3')
const migrations = require('../../api/lib/release-migrations')
const startup = require('../../api/lib/release-startup')
const released = require('./fixtures/released-86-ddl.json')
const { spawn } = require('node:child_process')

async function fixture(run, old = true) {
  const directory = fs.mkdtempSync(
    path.join(os.tmpdir(), 'slipway-update-test-')
  )
  try {
    if (old)
      for (const [datastore, statements] of Object.entries(
        released.datastores
      )) {
        const db = new Database(
          path.join(directory, migrations.files[datastore])
        )
        try {
          for (const sql of statements) db.exec(sql)
        } finally {
          db.close()
        }
      }
    return await run(directory)
  } finally {
    fs.rmSync(directory, { recursive: true, force: true })
  }
}

function edit(directory, filename, fn) {
  const db = new Database(path.join(directory, filename))
  try {
    return fn(db)
  } finally {
    db.close()
  }
}

function hashes(directory) {
  return Object.values(migrations.files).map((filename) =>
    crypto
      .createHash('sha256')
      .update(fs.readFileSync(path.join(directory, filename)))
      .digest('hex')
  )
}

test('released 86 clone validation leaves all live bytes untouched and runs no Sails hooks', () =>
  fixture(async (directory) => {
    const before = hashes(directory)
    assert.equal(
      await startup.beforeLift({ directory, role: 'preflight', listen: false }),
      false
    )
    assert.deepEqual(hashes(directory), before)
    assert.equal(global.sails, undefined)
    assert.equal(
      fs.existsSync(path.join(directory, 'migration-backups')),
      false
    )
  }))

test('released 86 upgrades through the Bosun executor, preserving founder, secret and custom objects', () =>
  fixture(async (directory) => {
    edit(directory, 'app.db', (db) => {
      db.exec(
        "INSERT INTO users (id, email, is_genesis_user, auth_version) VALUES (1, 'founder@example.test', 'true', 'session-preserved'); CREATE TABLE custom_notes (value TEXT); INSERT INTO custom_notes VALUES ('keep'); CREATE VIEW custom_view AS SELECT value FROM custom_notes; CREATE TRIGGER custom_trigger AFTER INSERT ON custom_notes BEGIN UPDATE custom_notes SET value=value; END;"
      )
      db.prepare('INSERT INTO apps (id, secure_env_vars) VALUES (?, ?)').run(
        1,
        'encrypted-secret-preserved'
      )
    })
    const result = await migrations.run({ directory })
    assert.ok(result.migratedDatastores > 0)
    edit(directory, 'app.db', (db) => {
      assert.equal(
        db.prepare('SELECT auth_version FROM users WHERE id=1').get()
          .auth_version,
        'session-preserved'
      )
      assert.equal(
        db.prepare('SELECT secure_env_vars FROM apps WHERE id=1').get()
          .secure_env_vars,
        'encrypted-secret-preserved'
      )
      assert.equal(
        db.prepare('SELECT value FROM custom_view').get().value,
        'keep'
      )
      assert.ok(
        db
          .prepare("SELECT name FROM sqlite_schema WHERE name='custom_trigger'")
          .get()
      )
      assert.ok(
        db
          .prepare(
            "SELECT name FROM sqlite_schema WHERE name='restore_tests_backup'"
          )
          .get()
      )
      const receipt = db
        .prepare(`SELECT * FROM ${migrations.receiptTable}`)
        .get()
      assert.equal(receipt.checksum, migrations.checksum)
      const backup = JSON.parse(receipt.backup)
      assert.equal(fs.statSync(backup.path).mode & 0o777, 0o600)
      assert.equal(
        crypto
          .createHash('sha256')
          .update(fs.readFileSync(backup.path))
          .digest('hex'),
        backup.sha256
      )
      const copy = new Database(backup.path, { readonly: true })
      try {
        assert.equal(copy.pragma('integrity_check', { simple: true }), 'ok')
        assert.equal(
          copy.prepare('SELECT auth_version FROM users WHERE id=1').get()
            .auth_version,
          'session-preserved'
        )
      } finally {
        copy.close()
      }
    })
    edit(directory, 'observability.db', (db) => {
      assert.ok(
        db
          .prepare("SELECT name FROM sqlite_schema WHERE name='quest_runs'")
          .get()
      )
      assert.ok(
        db
          .prepare(
            "SELECT name FROM sqlite_schema WHERE name='resource_alert_deliveries_due'"
          )
          .get()
      )
    })
    const before = hashes(directory)
    assert.equal((await migrations.run({ directory })).migratedDatastores, 0)
    assert.deepEqual(hashes(directory), before)
  }))

test('helper-upgraded app columns validate without rewriting defaults, secrets or live files', () =>
  fixture(async (directory) => {
    edit(directory, 'app.db', (db) => {
      const original = db
        .prepare("SELECT sql FROM sqlite_schema WHERE name='apps'")
        .get().sql
      db.exec('DROP TABLE apps')
      const base = original.replace(
        /, `(bridge_enabled|bridge_secret|bearing_enabled|bearing_secret|wake_enabled|wake_settings|wake_secret|secure_env_vars|env_var_metadata)` TEXT/g,
        ''
      )
      db.exec(base)
      // Exact ALTER definitions and order shipped by the legacy production helpers.
      db.exec(`ALTER TABLE apps ADD COLUMN bridge_enabled BOOLEAN NOT NULL DEFAULT 0;
        ALTER TABLE apps ADD COLUMN bridge_secret TEXT;
        ALTER TABLE apps ADD COLUMN secure_env_vars TEXT;
        ALTER TABLE apps ADD COLUMN env_var_metadata TEXT NOT NULL DEFAULT '{}';
        ALTER TABLE apps ADD COLUMN bearing_enabled BOOLEAN NOT NULL DEFAULT 0;
        ALTER TABLE apps ADD COLUMN bearing_secret TEXT;
        ALTER TABLE apps ADD COLUMN wake_enabled BOOLEAN NOT NULL DEFAULT 0;
        ALTER TABLE apps ADD COLUMN wake_secret TEXT;
        ALTER TABLE apps ADD COLUMN wake_settings TEXT NOT NULL DEFAULT '{}';`)
      db.prepare('INSERT INTO apps (id, secure_env_vars) VALUES (?, ?)').run(
        1,
        'keep-encrypted-secret'
      )
    })
    const before = hashes(directory)
    const ddl = edit(
      directory,
      'app.db',
      (db) =>
        db.prepare("SELECT sql FROM sqlite_schema WHERE name='apps'").get().sql
    )
    await migrations.run({ directory, preflightOnly: true })
    assert.deepEqual(hashes(directory), before)
    await migrations.run({ directory })
    edit(directory, 'app.db', (db) => {
      assert.equal(
        db.prepare("SELECT sql FROM sqlite_schema WHERE name='apps'").get().sql,
        ddl
      )
      assert.deepEqual(
        db
          .prepare(
            'SELECT secure_env_vars, wake_enabled, wake_settings, env_var_metadata FROM apps WHERE id=1'
          )
          .get(),
        {
          secure_env_vars: 'keep-encrypted-secret',
          wake_enabled: 0,
          wake_settings: '{}',
          env_var_metadata: '{}'
        }
      )
    })
    assert.equal((await migrations.run({ directory })).migratedDatastores, 0)
  }))

test('historical helper-created Bearing tables migrate without losing their native constraints', () =>
  fixture(async (directory) => {
    const historical =
      require('../../api/lib/releases/legacy-helper-ddl.json').entries
    const tables = [
      'bearing_spaces',
      'bearing_participants',
      'bearing_feedback',
      'bearing_updates',
      'bearing_votes'
    ]
    const definitions = {}
    edit(directory, 'app.db', (db) => {
      for (const name of tables) {
        const entry = historical.find(
          (entry) =>
            entry.source === 'api/helpers/bearing/ensure-schema.js' &&
            entry.sql.startsWith(`CREATE TABLE ${name} (`)
        )
        assert.ok(entry, name)
        db.exec(`DROP TABLE ${name}`)
        db.exec(entry.sql)
        definitions[name] = db
          .prepare('SELECT sql FROM sqlite_schema WHERE name = ?')
          .get(name).sql
      }
      db.exec(
        "INSERT INTO bearing_feedback (id, public_id, title, space, app) VALUES (1, 'keep-feedback', 'Keep this feedback', 1, 1)"
      )
    })
    const before = hashes(directory)
    await migrations.run({ directory, preflightOnly: true })
    assert.deepEqual(hashes(directory), before)
    await migrations.run({ directory })
    edit(directory, 'app.db', (db) => {
      for (const name of tables)
        assert.equal(
          db.prepare('SELECT sql FROM sqlite_schema WHERE name = ?').get(name)
            .sql,
          definitions[name]
        )
      assert.equal(
        db.prepare('SELECT title FROM bearing_feedback WHERE id = 1').get()
          .title,
        'Keep this feedback'
      )
    })
    assert.equal((await migrations.run({ directory })).migratedDatastores, 0)
  }))

test('legacy compatibility still rejects changed constraints and unknown app columns', async () => {
  for (const addition of [
    'ALTER TABLE apps ADD COLUMN unknown_column TEXT',
    'ALTER TABLE apps RENAME COLUMN name TO wrong_name'
  ])
    await fixture(async (directory) => {
      edit(directory, 'app.db', (db) => db.exec(addition))
      const before = hashes(directory)
      await assert.rejects(
        migrations.run({ directory }),
        /incompatible default.apps/
      )
      assert.deepEqual(hashes(directory), before)
    })
  const compatible = require('../../api/lib/release-legacy-schema')
  const definition = require('../../api/lib/releases/0.0.88.json').datastores
    .default.apps
  for (const sql of [
    definition.create.replace(
      '`wake_enabled` TEXT',
      '`wake_enabled` BOOLEAN NOT NULL DEFAULT 1'
    ),
    definition.create.replace(
      '`name` TEXT',
      '`name` TEXT CHECK (length(name) < 2)'
    ),
    definition.create.replace('`name` TEXT', '`name` TEXT COLLATE NOCASE'),
    definition.create.replace(', `wake_settings` TEXT', '')
  ])
    assert.equal(compatible('default', 'apps', sql, definition), false)
})

test('fresh production databases initialize without a host bundle or manual DDL', () =>
  fixture(async (directory) => {
    assert.equal((await migrations.run({ directory })).migratedDatastores, 4)
    assert.equal((await migrations.run({ directory })).migratedDatastores, 0)
  }, false))

test('incompatible owned definitions block every live step during clone preflight', () =>
  fixture(async (directory) => {
    edit(directory, 'observability.db', (db) =>
      db.exec('ALTER TABLE telemetry_spans ADD COLUMN ambiguous TEXT')
    )
    const before = hashes(directory)
    await assert.rejects(
      migrations.run({ directory }),
      /incompatible observability.telemetry_spans/
    )
    assert.deepEqual(hashes(directory), before)
    assert.equal(
      fs.existsSync(path.join(directory, 'migration-backups')),
      false
    )
  }))

test('missing existing datastore fails validation without creating live files', () =>
  fixture(async (directory) => {
    fs.unlinkSync(path.join(directory, 'stash.db'))
    await assert.rejects(
      migrations.run({ directory, preflightOnly: true }),
      /datastore is missing/
    )
    assert.equal(fs.existsSync(path.join(directory, 'stash.db')), false)
  }))

test('interrupted second datastore rolls back its DDL and receipt; restart resumes the remaining steps', () =>
  fixture(async (directory) => {
    let failed = false
    await assert.rejects(
      migrations.run({
        directory,
        beforeCommit({ service }) {
          if (service.datastore === 'observability') {
            failed = true
            throw new Error('injected precommit failure')
          }
        }
      }),
      /rolledBack/
    )
    assert.ok(failed)
    edit(directory, 'app.db', (db) =>
      assert.ok(db.prepare(`SELECT * FROM ${migrations.receiptTable}`).get())
    )
    edit(directory, 'observability.db', (db) => {
      assert.equal(
        db
          .prepare("SELECT name FROM sqlite_schema WHERE name='quest_runs'")
          .get(),
        undefined
      )
      assert.equal(
        db
          .prepare('SELECT name FROM sqlite_schema WHERE name=?')
          .get(migrations.receiptTable),
        undefined
      )
    })
    assert.ok(
      fs.readdirSync(path.join(directory, 'migration-backups')).length >= 2
    )
    assert.ok((await migrations.run({ directory })).migratedDatastores >= 1)
    assert.equal((await migrations.run({ directory })).migratedDatastores, 0)
  }))

test('receipt checksum and reserved object collisions fail before live changes', () =>
  fixture(async (directory) => {
    await migrations.run({ directory })
    edit(directory, 'app.db', (db) =>
      db
        .prepare(`UPDATE ${migrations.receiptTable} SET checksum=?`)
        .run('changed')
    )
    const before = hashes(directory)
    await assert.rejects(migrations.run({ directory }), /checksum differs/)
    assert.deepEqual(hashes(directory), before)
  }))

for (const datastore of ['default', 'observability'])
  test(`SIGKILL during ${datastore} leaves only complete transaction receipts and resumes safely`, () =>
    fixture(async (directory) => {
      edit(directory, migrations.files[datastore], (db) =>
        db.exec(
          "CREATE TABLE restart_marker(value TEXT, payload BLOB); INSERT INTO restart_marker VALUES ('preserved', NULL)"
        )
      )
      const child = spawn(
        process.execPath,
        [
          path.join(__dirname, 'fixtures/release-step-child.cjs'),
          directory,
          datastore
        ],
        { stdio: ['ignore', 'pipe', 'pipe'] }
      )
      let output = ''
      let errors = ''
      const exited = new Promise((resolve) =>
        child.once('exit', (code, signal) => resolve({ code, signal }))
      )
      await new Promise((resolve, reject) => {
        const deadline = setTimeout(() => {
          child.kill('SIGKILL')
          reject(
            new Error(`Owned fixture did not reach its transaction: ${errors}`)
          )
        }, 10000)
        child.stderr.on('data', (chunk) => {
          errors += chunk
        })
        child.stdout.on('data', (chunk) => {
          output += chunk
          if (output.includes('transaction-ready')) {
            clearTimeout(deadline)
            resolve()
          }
        })
        child.once('error', (error) => {
          clearTimeout(deadline)
          reject(error)
        })
        child.once('exit', () => {
          clearTimeout(deadline)
          if (!output.includes('transaction-ready'))
            reject(new Error(errors || 'Fixture exited before its transaction'))
        })
      })
      child.kill('SIGKILL')
      assert.equal((await exited).signal, 'SIGKILL')
      const interrupted = hashes(directory)
      await assert.rejects(migrations.run({ directory, preflightOnly: true }), {
        code: 'SQLITE_READONLY_ROLLBACK'
      })
      assert.deepEqual(hashes(directory), interrupted)
      if (datastore === 'observability')
        edit(directory, 'app.db', (db) =>
          assert.ok(
            db.prepare(`SELECT * FROM ${migrations.receiptTable}`).get()
          )
        )
      // Restart directly: no writable observer may pre-recover a hot journal.
      let checkedReceipt = false
      const resumed = await migrations.run({
        directory,
        beforeCommit({ service, database }) {
          if (service.datastore !== datastore) return
          assert.equal(
            database
              .prepare('SELECT name FROM sqlite_schema WHERE name=?')
              .get(migrations.receiptTable),
            undefined
          )
          assert.deepEqual(
            database.prepare('SELECT * FROM restart_marker').get(),
            { value: 'preserved', payload: null }
          )
          checkedReceipt = true
        }
      })
      assert.ok(checkedReceipt)
      assert.ok(resumed.migratedDatastores >= 1)
      assert.equal((await migrations.run({ directory })).migratedDatastores, 0)
    }))

test('receipt schema regression blocks startup for review', () =>
  fixture(async (directory) => {
    await migrations.run({ directory })
    edit(directory, 'app.db', (db) => db.exec('DROP TABLE restore_tests'))
    await assert.rejects(
      migrations.run({ directory }),
      /recorded release schema changed/
    )
  }))

test('aliased datastore files block startup for review', () =>
  fixture(async (directory) => {
    fs.unlinkSync(path.join(directory, 'stash.db'))
    fs.linkSync(
      path.join(directory, 'analytics.db'),
      path.join(directory, 'stash.db')
    )
    await assert.rejects(
      migrations.run({ directory }),
      /distinct regular files/
    )
  }))

const self = {
  Id: 'current-full-id',
  Name: '/slipway',
  Config: { Hostname: 'current' },
  State: { Running: true },
  Mounts: [
    {
      Destination: '/app/db',
      Source: '/var/lib/docker/volumes/slipway-db/_data',
      RW: true
    }
  ]
}
test('Docker validation identity uses the existing container name; normal startup rejects overlapping writers', () => {
  assert.equal(
    startup.dockerRole({
      containers: [{ ...self, Name: '/slipway-next' }],
      hostname: 'current',
      directory: '/app/db'
    }),
    'preflight'
  )
  assert.equal(
    startup.dockerRole({
      containers: [self],
      hostname: 'current',
      directory: '/app/db'
    }),
    'startup'
  )
  const writer = {
    ...self,
    Id: 'other',
    Config: { Hostname: 'other' },
    Mounts: [
      {
        Destination: '/data',
        Source: '/var/lib/docker/volumes/slipway-db',
        RW: true
      }
    ]
  }
  assert.throws(
    () =>
      startup.dockerRole({
        containers: [self, writer],
        hostname: 'current',
        directory: '/app/db'
      }),
    /Another running Docker container/
  )
  assert.equal(
    startup.dockerRole({
      containers: [self, { ...writer, State: { Running: false } }],
      hostname: 'current',
      directory: '/app/db'
    }),
    'startup'
  )
  assert.throws(
    () =>
      startup.dockerRole({
        containers: [self],
        hostname: 'unknown',
        directory: '/app/db'
      }),
    /Could not identify/
  )
})

test('production helpers verify receipts without issuing DDL and retain data backfills', () =>
  fixture(async (directory) => {
    await migrations.run({ directory })
    const previous = {
      sails: global.sails,
      App: global.App,
      Setting: global.Setting,
      Service: global.Service
    }
    const connections = new Map()
    const queries = []
    const updates = []
    try {
      const datastores = Object.fromEntries(
        Object.entries(migrations.files).map(([name, file]) => [
          name,
          { adapter: 'sails-sqlite', url: path.join(directory, file) }
        ])
      )
      for (const [name, config] of Object.entries(datastores))
        connections.set(name, new Database(config.url))
      global.sails = {
        config: { environment: 'production', datastores },
        getDatastore(name = 'default') {
          const manager = connections.get(name)
          return {
            manager,
            async sendNativeQuery(sql, values = []) {
              assert.doesNotMatch(sql, /^\s*(CREATE|ALTER|DROP|REINDEX)\b/i)
              queries.push(sql)
              return manager.prepare(sql).run(...values)
            }
          }
        }
      }
      global.Setting = {
        findOne: async () => ({ key: 'teamMembershipMigration' })
      }
      global.App = {
        find: () => ({
          decrypt: async () => [
            {
              id: 1,
              secureEnvVars: null,
              envVars: { legacy: 'encrypted-by-model' }
            }
          ]
        }),
        updateOne: () => ({ set: async (value) => updates.push(value) })
      }
      global.Service = {
        update: () => ({ set: async (value) => updates.push(value) })
      }
      for (const helper of [
        'auth/ensure-schema',
        'team/ensure-schema',
        'git/ensure-webhook-schema',
        'source/ensure-schema',
        'backup/ensure-restore-schema',
        'backup/ensure-test-schema',
        'backup/ensure-storage-schema',
        'cleanup/ensure-schema',
        'bridge/ensure-schema',
        'bearing/ensure-schema',
        'wake/ensure-app-schema',
        'wake/ensure-schema',
        'configuration/ensure-schema',
        'flag/ensure-schema',
        'deploy/ensure-queue-schema',
        'service/ensure-version-schema',
        'helm/ensure-workspace-schema',
        'lookout/ensure-observability-schema'
      ])
        await require(`../../api/helpers/${helper}`).fn()
      assert.equal(global.sails.wakeStorageReady, true)
      assert.ok(queries.some((sql) => /UPDATE bearing_feedback/.test(sql)))
      assert.ok(queries.some((sql) => /UPDATE telemetry_spans/.test(sql)))
      assert.deepEqual(updates, [
        { secureEnvVars: { legacy: 'encrypted-by-model' }, envVars: {} },
        { status: 'failed' }
      ])
      const health = await require('../../api/controllers/health/check').fn()
      assert.deepEqual(health.releaseMigrations, {
        ready: true,
        version: '0.0.88',
        checksum: migrations.checksum
      })
      connections
        .get('default')
        .prepare(`UPDATE ${migrations.receiptTable} SET checksum='wrong'`)
        .run()
      await assert.rejects(
        require('../../api/helpers/backup/ensure-test-schema').fn(),
        /checksum differs/
      )
      await assert.rejects(
        require('../../api/controllers/health/check').fn(),
        /checksum differs/
      )
    } finally {
      for (const connection of connections.values()) connection.close()
      for (const [name, value] of Object.entries(previous)) {
        if (value === undefined) delete global[name]
        else global[name] = value
      }
    }
  }))

test('insufficient capacity and expired startup deadline leave released database bytes unchanged', () =>
  fixture(async (directory) => {
    const before = hashes(directory)
    await assert.rejects(
      migrations.run({ directory, availableBytes: () => 0 }),
      /Insufficient disk space/
    )
    assert.deepEqual(hashes(directory), before)
    await assert.rejects(
      migrations.run({ directory, maxDurationMs: 0 }),
      /deadline/
    )
    assert.deepEqual(hashes(directory), before)
  }))

test('fixed small and 64 MiB fixtures report three preflight/apply samples with preserved data', async (context) => {
  const samples = []
  for (const payloadBytes of [1024, 64 * 1024 * 1024]) {
    for (let sample = 0; sample < 3; sample++)
      await fixture(async (directory) => {
        edit(directory, 'app.db', (db) => {
          db.exec('CREATE TABLE performance_payload (value BLOB)')
          db.prepare(
            'INSERT INTO performance_payload VALUES (zeroblob(?))'
          ).run(payloadBytes)
        })
        const sourceBytes = Object.values(migrations.files).reduce(
          (sum, file) => sum + fs.statSync(path.join(directory, file)).size,
          0
        )
        const result = await migrations.run({ directory })
        edit(directory, 'app.db', (db) =>
          assert.equal(
            db
              .prepare('SELECT length(value) AS bytes FROM performance_payload')
              .get().bytes,
            payloadBytes
          )
        )
        const backupDirectory = path.join(directory, 'migration-backups')
        const backupBytes = fs
          .readdirSync(backupDirectory)
          .reduce(
            (sum, file) =>
              sum + fs.statSync(path.join(backupDirectory, file)).size,
            0
          )
        samples.push({
          payloadBytes,
          sourceBytes,
          backupBytes,
          ...result.timings
        })
        const repeat = await migrations.run({
          directory,
          availableBytes: () => 0
        })
        assert.equal(repeat.migratedDatastores, 0)
      })
  }
  context.diagnostic(JSON.stringify({ releasePerformance: samples }))
})

test('partial and complete manual Bosun adoption retain data and settle to byte-identical restart', async () => {
  for (const complete of [false, true])
    await fixture(async (directory) => {
      edit(directory, 'app.db', (db) =>
        db.exec(
          "CREATE TABLE adoption_marker (value TEXT); INSERT INTO adoption_marker VALUES ('keep')"
        )
      )
      for (const [datastore, file] of Object.entries(migrations.files)) {
        if (!complete && datastore !== 'default') continue
        const plan = migrations.prepare({
          type: 'sqlite',
          datastore,
          path: path.join(directory, file)
        })
        edit(directory, file, (db) => {
          for (const statement of complete
            ? plan.statements
            : plan.statements.slice(0, 2))
            db.exec(statement.sql)
        })
      }
      await migrations.run({ directory })
      edit(directory, 'app.db', (db) =>
        assert.equal(
          db.prepare('SELECT value FROM adoption_marker').get().value,
          'keep'
        )
      )
      const before = hashes(directory)
      assert.equal((await migrations.run({ directory })).migratedDatastores, 0)
      assert.deepEqual(hashes(directory), before)
    })
})

test('production processes cannot enable legacy DDL through absent or test-mode Sails config', () => {
  const ready = require('../../api/lib/release-schema-ready')
  const previous = process.env.NODE_ENV
  try {
    process.env.NODE_ENV = 'development'
    assert.equal(ready({}), false)
    process.env.NODE_ENV = 'production'
    assert.throws(() => ready({}), /release schema is not ready/)
    assert.throws(
      () => ready({ config: { environment: 'test' } }),
      /release schema is not ready/
    )
  } finally {
    if (previous === undefined) delete process.env.NODE_ENV
    else process.env.NODE_ENV = previous
  }
})
