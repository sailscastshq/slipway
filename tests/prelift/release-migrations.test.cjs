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
      edit(directory, migrations.files[datastore], (db) =>
        assert.equal(
          db
            .prepare('SELECT name FROM sqlite_schema WHERE name=?')
            .get(migrations.receiptTable),
          undefined
        )
      )
      if (datastore === 'observability')
        edit(directory, 'app.db', (db) =>
          assert.ok(
            db.prepare(`SELECT * FROM ${migrations.receiptTable}`).get()
          )
        )
      assert.ok((await migrations.run({ directory })).migratedDatastores >= 1)
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
