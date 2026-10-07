const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const crypto = require('node:crypto')
const Database = require('better-sqlite3')
const migrations = require('../../api/lib/release-migrations')
const matches = require('../../api/lib/release-schema-layout')
const seed = require('./fixtures/seed-legacy-production.cjs')
const legacy = require('./fixtures/legacy-production-ddl.json')

async function fixture(run, layouts = legacy) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'slipway-legacy-'))
  try {
    seed(directory, layouts)
    return await run(directory)
  } finally {
    fs.rmSync(directory, { recursive: true, force: true })
  }
}

function hashes(directory) {
  return Object.values(migrations.files).map((file) =>
    crypto
      .createHash('sha256')
      .update(fs.readFileSync(path.join(directory, file)))
      .digest('hex')
  )
}

function rows(directory) {
  const result = {}
  for (const [datastore, file] of Object.entries(migrations.files)) {
    const db = new Database(path.join(directory, file), { readonly: true })
    try {
      result[datastore] = {}
      for (const { name } of db
        .prepare(
          `SELECT name FROM sqlite_schema
        WHERE type='table' AND name NOT LIKE 'sqlite_%' AND name!=? ORDER BY name`
        )
        .all(migrations.receiptTable)) {
        result[datastore][name] = db
          .prepare(
            `SELECT * FROM "${name.replaceAll('"', '""')}" ORDER BY rowid`
          )
          .all()
      }
    } finally {
      db.close()
    }
  }
  return result
}

test('affected legacy catalog passes clone admission without changing live bytes', () =>
  fixture(async (directory) => {
    const before = hashes(directory)
    assert.equal(
      (await migrations.run({ directory, preflightOnly: true })).mode,
      'preflight'
    )
    assert.deepEqual(hashes(directory), before)
    assert.equal(
      fs.existsSync(path.join(directory, 'migration-backups')),
      false
    )
  }))

test('legacy upgrade preserves every row, historical column and constraint; restart is byte-identical', () =>
  fixture(async (directory) => {
    const before = rows(directory)
    await migrations.run({ directory })
    assert.deepEqual(rows(directory), before)
    for (const [datastore, file] of Object.entries(migrations.files)) {
      assert.equal(
        migrations.current({ path: path.join(directory, file), datastore }),
        true
      )
      const db = new Database(path.join(directory, file), { readonly: true })
      assert.equal(db.pragma('integrity_check', { simple: true }), 'ok')
      assert.deepEqual(db.pragma('foreign_key_check'), [])
      db.close()
    }
    const bytes = hashes(directory)
    assert.equal((await migrations.run({ directory })).migratedDatastores, 0)
    assert.deepEqual(hashes(directory), bytes)
  }))

test('layout matching ignores column order and identifier quoting while preserving declarations', () => {
  const expected =
    'CREATE TABLE apps (`id` INTEGER PRIMARY KEY, name TEXT, flag BOOLEAN NOT NULL DEFAULT 0, CHECK (flag IN (0,1)))'
  assert.equal(
    matches(
      'CREATE TABLE "apps" (CHECK (flag IN (0, 1)), [flag] BOOLEAN NOT NULL DEFAULT 0, `name` TEXT, "id" INTEGER PRIMARY KEY)',
      [expected]
    ),
    true
  )
  for (const sql of [
    expected.replace('DEFAULT 0', 'DEFAULT 1'),
    expected.replace('BOOLEAN', 'BLOB'),
    expected.replace('NOT NULL ', ''),
    expected.replace('name TEXT', 'name TEXT COLLATE NOCASE'),
    expected.replace('IN (0,1)', 'IN (0,1,2)'),
    expected + ' STRICT'
  ])
    assert.equal(matches(sql, [expected]), false)
})

test('index formatting is equivalent, but keys, collations, uniqueness and predicates remain guarded', () => {
  const expected =
    'CREATE UNIQUE INDEX apps_slug ON apps (environment, slug COLLATE NOCASE) WHERE slug IS NOT NULL'
  assert.equal(
    matches.index(
      'CREATE UNIQUE INDEX IF NOT EXISTS "apps_slug" ON [apps]("environment", `slug` COLLATE NOCASE) WHERE slug IS NOT NULL;',
      [expected]
    ),
    true
  )
  for (const sql of [
    expected.replace('UNIQUE ', ''),
    expected.replace('environment, slug', 'slug, environment'),
    expected.replace('COLLATE NOCASE', 'COLLATE BINARY'),
    expected.replace(' IS NOT NULL', ' IS NULL')
  ])
    assert.equal(matches.index(sql, [expected]), false)
})

for (const [name, replace] of [
  ['unexpected extra column', (sql) => sql.slice(0, -1) + ', unknown TEXT)'],
  [
    'changed type',
    (sql) => sql.replace('`health_path` TEXT', '`health_path` BLOB')
  ],
  [
    'changed default',
    (sql) => sql.replace("DEFAULT '/health'", "DEFAULT '/HEALTH'")
  ],
  [
    'unknown CHECK constraint',
    (sql) => sql.slice(0, -1) + ', CHECK (port > 0))'
  ]
])
  test(`${name} still blocks all live changes`, () => {
    const layouts = structuredClone(legacy)
    layouts.datastores.default = layouts.datastores.default.map((sql) =>
      sql.startsWith('CREATE TABLE `apps`') ? replace(sql) : sql
    )
    return fixture(async (directory) => {
      const before = hashes(directory)
      await assert.rejects(
        migrations.run({ directory }),
        /incompatible default.apps/
      )
      assert.deepEqual(hashes(directory), before)
      assert.equal(
        fs.existsSync(path.join(directory, 'migration-backups')),
        false
      )
    }, layouts)
  })
