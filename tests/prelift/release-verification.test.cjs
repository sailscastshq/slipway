const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const crypto = require('node:crypto')
const vm = require('node:vm')
const { createRequire } = require('node:module')
const { spawn } = require('node:child_process')
const { once } = require('node:events')
const Database = require('better-sqlite3')
const migrations = require('../../api/lib/release-migrations')
const released = require('./fixtures/released-86-ddl.json')

async function fixture(fn, payloadBytes = 0) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'slipway-verification-'))
  const directory = path.join(root, 'live')
  fs.mkdirSync(directory)
  try {
    for (const [datastore, statements] of Object.entries(released.datastores)) {
      const db = new Database(path.join(directory, migrations.files[datastore]))
      try {
        for (const sql of statements) db.exec(sql)
        db.exec('CREATE TABLE verification_data (value TEXT, payload BLOB)')
        db.prepare('INSERT INTO verification_data VALUES (?, zeroblob(?))').run(
          'preserved',
          datastore === 'default' ? payloadBytes : 0
        )
      } finally {
        db.close()
      }
    }
    return await fn({ root, directory })
  } finally {
    fs.rmSync(root, { recursive: true, force: true })
  }
}

function hashes(directory) {
  return Object.values(migrations.files).map((name) =>
    crypto
      .createHash('sha256')
      .update(fs.readFileSync(path.join(directory, name)))
      .digest('hex')
  )
}
function receipt(directory, datastore = 'default') {
  const db = new Database(path.join(directory, migrations.files[datastore]), {
    readonly: true
  })
  try {
    if (
      !db
        .prepare('SELECT name FROM sqlite_schema WHERE name=?')
        .get(migrations.receiptTable)
    )
      return undefined
    return db.prepare(`SELECT * FROM ${migrations.receiptTable}`).get()
  } finally {
    db.close()
  }
}
function child(mode, root) {
  const process = spawn(
    global.process.execPath,
    [
      path.join(__dirname, 'fixtures/release-verification-child.cjs'),
      mode,
      root
    ],
    { stdio: ['pipe', 'pipe', 'pipe'] }
  )
  let output = '',
    errors = ''
  process.stdout.on('data', (chunk) => {
    output += chunk
  })
  process.stderr.on('data', (chunk) => {
    errors += chunk
  })
  const exited = once(process, 'exit')
  return {
    async ready() {
      const started = performance.now()
      while (!output.includes('ready\n')) {
        assert.equal(process.exitCode, null, errors)
        assert.ok(
          performance.now() - started < 5000,
          'Owned fixture startup deadline'
        )
        await new Promise((resolve) => setTimeout(resolve, 5))
      }
    },
    async finish() {
      process.stdin.end('finish\n')
      const [code, signal] = await exited
      assert.equal(signal, null, errors)
      assert.equal(code, 0, errors)
      return output
    },
    async cleanup() {
      if (process.exitCode === null && process.signalCode === null) {
        process.kill('SIGKILL')
        await exited
      }
    }
  }
}

// Fault the actual native connection, not a replacement migration algorithm.
// Only the first live app.db connection is affected; clone preflight is unchanged.
function faultedMigrations(directory, fault, observations) {
  function FaultDatabase(filename, options) {
    const db = new Database(filename, options)
    if (filename !== path.join(directory, 'app.db') || options?.readonly)
      return db
    return new Proxy(db, {
      get(target, key) {
        if (key === 'backup')
          return async (destination, options = {}) => {
            if (!observations.fired && fault === 'backup-interruption') {
              return target.backup(destination, {
                progress(info) {
                  const copiedPages = info.totalPages - info.remainingPages
                  if (!copiedPages) return 200
                  observations.fired = true
                  observations.remainingPages = info.remainingPages
                  observations.copiedPages = copiedPages
                  throw new Error('Injected interruption during native backup')
                }
              })
            }
            const result = await target.backup(destination, options)
            if (!observations.fired && fault === 'backup-corruption') {
              observations.fired = true
              fs.writeFileSync(destination, 'invalid SQLite recovery snapshot')
            }
            return result
          }
        if (key === 'exec')
          return (sql) => {
            if (
              sql === 'COMMIT' &&
              !observations.fired &&
              fault.startsWith('commit-')
            ) {
              observations.fired = true
              if (fault === 'commit-after') target.exec(sql)
              throw new Error('Injected lost COMMIT result')
            }
            return target.exec(sql)
          }
        const value = Reflect.get(target, key, target)
        return typeof value === 'function' ? value.bind(target) : value
      }
    })
  }
  function load(relative, overrides) {
    const filename = path.resolve(__dirname, relative)
    const localRequire = createRequire(filename)
    const module = { exports: {} }
    vm.runInNewContext(
      fs.readFileSync(filename, 'utf8'),
      {
        module,
        exports: module.exports,
        require: (name) => overrides[name] || localRequire(name),
        performance,
        process,
        Buffer,
        console,
        __dirname: path.dirname(filename)
      },
      { filename }
    )
    return module.exports
  }
  const executor = load('../../api/lib/migration-executor.js', {
    'better-sqlite3': FaultDatabase
  })
  return load('../../api/lib/release-migrations.js', {
    './migration-executor': executor
  })
}

test('a real competing process bounds SQLite writer admission and retries only after release', (context) =>
  fixture(async ({ directory }) => {
    const before = hashes(directory)
    const owner = child('lock', path.join(directory, 'app.db'))
    try {
      await owner.ready()
      const started = performance.now()
      await assert.rejects(migrations.run({ directory }), /database is locked/)
      const elapsedMs = performance.now() - started
      assert.ok(
        elapsedMs >= 4500 && elapsedMs < 9000,
        `Writer wait ${elapsedMs} ms`
      )
      assert.deepEqual(hashes(directory), before)
      assert.equal(receipt(directory), undefined)
      context.diagnostic(
        JSON.stringify({
          contentionElapsedMs: elapsedMs,
          nativeLockTimeoutMs: 5000,
          liveBytesUnchanged: true
        })
      )
      await owner.finish()
      assert.equal((await migrations.run({ directory })).migratedDatastores, 4)
      assert.equal((await migrations.run({ directory })).migratedDatastores, 0)
    } finally {
      await owner.cleanup()
    }
  }))

for (const fault of ['backup-interruption', 'backup-corruption'])
  test(`${fault} refuses live mutation, removes incomplete snapshot and permits verified retry`, (context) =>
    fixture(async ({ directory }) => {
      const before = hashes(directory)
      const observations = {}
      await assert.rejects(
        faultedMigrations(directory, fault, observations).run({ directory }),
        /Release migration failed/
      )
      assert.ok(observations.fired)
      if (fault === 'backup-interruption') {
        assert.ok(observations.remainingPages > 0)
        assert.ok(observations.copiedPages > 0)
      }
      assert.deepEqual(hashes(directory), before)
      assert.equal(receipt(directory), undefined)
      assert.deepEqual(
        fs.readdirSync(path.join(directory, 'migration-backups')),
        []
      )
      assert.equal((await migrations.run({ directory })).migratedDatastores, 4)
      context.diagnostic(
        JSON.stringify({
          fault,
          observations,
          liveBytesUnchanged: true,
          incompleteSnapshotRemoved: true
        })
      )
    }, 4 * 1024 * 1024))

for (const fault of ['commit-before', 'commit-after'])
  test(`${fault} reports unconfirmed and reconciles schema plus receipt before retry`, (context) =>
    fixture(async ({ directory }) => {
      const observations = {}
      await assert.rejects(
        faultedMigrations(directory, fault, observations).run({ directory }),
        /unconfirmed/
      )
      assert.ok(observations.fired)
      const committed = receipt(directory)
      assert.equal(Boolean(committed), fault === 'commit-after')
      const count = (await migrations.run({ directory })).migratedDatastores
      assert.equal(count, fault === 'commit-after' ? 3 : 4)
      if (committed) assert.deepEqual(receipt(directory), committed)
      context.diagnostic(
        JSON.stringify({
          fault,
          committedBeforeRetry: Boolean(committed),
          resumedDatastores: count,
          committedReceiptPreserved: Boolean(committed)
        })
      )
      const settled = hashes(directory)
      assert.equal((await migrations.run({ directory })).migratedDatastores, 0)
      assert.deepEqual(hashes(directory), settled)
      const db = new Database(path.join(directory, 'app.db'), {
        readonly: true
      })
      try {
        assert.equal(
          db.prepare('SELECT value FROM verification_data').get().value,
          'preserved'
        )
      } finally {
        db.close()
      }
    }))

test('external disk polling observes journals, live growth, clones and retained backups on bounded fixed fixtures', async (context) => {
  const measurements = []
  for (const payloadBytes of [1024, 64 * 1024 * 1024])
    for (let iteration = 0; iteration < 3; iteration++)
      await fixture(async ({ root, directory }) => {
        const temporary = path.join(root, 'temporary')
        fs.mkdirSync(temporary)
        const sampler = child('sample', root)
        const previousTmp = process.env.TMPDIR
        try {
          await sampler.ready()
          process.env.TMPDIR = temporary
          await migrations.run({
            directory,
            async beforeCommit({ database }) {
              // Hold the real journal long enough for an external sample. This
              // 100 ms fixture pause is disclosed and is not production timing.
              await new Promise((resolve) => setTimeout(resolve, 100))
            }
          })
          const lines = (await sampler.finish()).trim().split('\n')
          const measurement = JSON.parse(lines[lines.length - 1])
          assert.ok(measurement.samples > 10)
          assert.ok(measurement.elapsedMs < 20000)
          assert.ok(measurement.liveJournalPeak.logical > 0)
          assert.ok(measurement.liveJournalPeak.allocated > 0)
          for (const category of [
            'journals',
            'liveGrowth',
            'clones',
            'backups'
          ]) {
            assert.ok(measurement.categories[category]?.logical > 0, category)
            assert.ok(measurement.categories[category]?.allocated > 0, category)
          }
          const db = new Database(path.join(directory, 'app.db'), {
            readonly: true
          })
          try {
            assert.deepEqual(
              db
                .prepare(
                  'SELECT value, length(payload) AS bytes FROM verification_data'
                )
                .get(),
              { value: 'preserved', bytes: payloadBytes }
            )
          } finally {
            db.close()
          }
          measurements.push({
            payloadBytes,
            iteration,
            intervalMs: 2,
            fixturePausePerCommitMs: 100,
            ...measurement
          })
        } finally {
          if (previousTmp === undefined) delete process.env.TMPDIR
          else process.env.TMPDIR = previousTmp
          await sampler.cleanup()
        }
      }, payloadBytes)
  context.diagnostic(JSON.stringify({ sampledDiskUsage: measurements }))
})
