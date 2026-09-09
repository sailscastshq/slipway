const { test } = require('sounding')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const Database = require('better-sqlite3')
const {
  typeFingerprint,
  indexFingerprint
} = require('../../../../api/lib/schema-contract')

test('physical type fingerprints preserve lengths, precision, ranges, and signedness', ({
  expect
}) => {
  expect(typeFingerprint('character varying(64)', 'postgresql')).toBe(
    typeFingerprint('VARCHAR(64)', 'postgresql')
  )
  for (const [dialect, left, right] of [
    ['postgresql', 'varchar(32)', 'varchar(64)'],
    ['postgresql', 'numeric(8,2)', 'numeric(10,3)'],
    ['postgresql', 'real', 'double precision'],
    ['mysql', 'int unsigned', 'int'],
    ['mysql', 'decimal(8,2)', 'decimal(8,3)']
  ])
    expect(
      typeFingerprint(left, dialect) === typeFingerprint(right, dialect)
    ).toBe(false)
  expect(
    indexFingerprint({ unique: true, columns: ['a', 'b'] }) ===
      indexFingerprint({ unique: true, columns: ['b', 'a'] })
  ).toBe(false)
  expect(typeFingerprint('int(11) unsigned', 'mysql')).toBe('integer unsigned')
  expect(typeFingerprint('timestamp(6) with time zone', 'postgresql')).toBe(
    'timestamptz(6)'
  )
})

test('SQLite unique changes round trip without confusing regular, partial, or expression indexes', async ({
  sails,
  expect
}) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'slipway-contract-'))
  const filename = path.join(dir, 'fixture.db')
  const db = new Database(filename)
  try {
    db.exec(`CREATE TABLE people (id INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL, email TEXT NOT NULL DEFAULT 'native', extra TEXT CHECK(length(extra) < 100));
      CREATE INDEX idx_people_email ON people(email);
      CREATE UNIQUE INDEX people_partial ON people(email) WHERE extra IS NOT NULL;
      CREATE INDEX people_expression ON people(lower(email));
      CREATE INDEX people_ordered ON people(extra DESC, email);
      CREATE VIEW emails AS SELECT email FROM people;
      INSERT INTO people(email) VALUES ('one@example.test');`)
    const models = {
      person: {
        tableName: 'people',
        primaryKey: 'id',
        attributes: {
          id: { type: 'number', autoIncrement: true },
          email: {
            type: 'string',
            unique: true,
            required: false,
            defaultsTo: 'application-only'
          }
        }
      }
    }
    const service = { type: 'sqlite', path: filename }
    const schema = await sails.helpers.dock.getSchema(service)
    const diff = await sails.helpers.dock.generateDiff(
      models,
      schema.tables,
      'sqlite'
    )
    expect(diff.state).toBe('changes_pending')
    expect(diff.columnsToModify).toEqual([])
    expect(diff.indexesToCreate.length).toBe(1)
    const migration = await sails.helpers.dock.generateMigrationSql(
      diff,
      'sqlite',
      models,
      schema.tables
    )
    const result = await sails.helpers.dock.applySqliteMigration(
      filename,
      migration.statements
    )
    expect(result.success).toBe(true)
    const after = await sails.helpers.dock.getSchema(service)
    const clean = await sails.helpers.dock.generateDiff(
      models,
      after.tables,
      'sqlite'
    )
    expect(clean.state).toBe('up_to_date')
    expect(clean.indexesToCreate).toEqual([])
    expect(
      await sails.helpers.dock.generateDiff(models, after.tables, 'sqlite')
    ).toEqual(clean)
    expect(db.prepare('SELECT email FROM emails').all()).toEqual([
      { email: 'one@example.test' }
    ])
    expect(after.tables.people.sql).toBe(schema.tables.people.sql)
    expect(after.tables.people.indexes.length).toBe(5)
  } finally {
    db.close()
    fs.rmSync(dir, { recursive: true, force: true })
  }
})

test('identity changes and incomplete catalogs are unverified, never executable', async ({
  sails,
  expect
}) => {
  const models = {
    person: {
      tableName: 'people',
      primaryKey: 'id',
      attributes: { id: { type: 'number', autoIncrement: true } }
    }
  }
  for (const catalogComplete of [true, false]) {
    const schema = {
      people: {
        catalogComplete,
        columns: [
          {
            name: 'id',
            type: 'integer',
            primaryKey: true,
            autoIncrement: false
          }
        ],
        indexes: []
      }
    }
    const diff = await sails.helpers.dock.generateDiff(
      models,
      schema,
      'postgresql'
    )
    expect(diff.state).toBe('unverified')
    const migration = await sails.helpers.dock.generateMigrationSql(
      diff,
      'postgresql',
      models,
      schema
    )
    expect(migration.statements.every((item) => item.blocked)).toBe(true)
  }
})
