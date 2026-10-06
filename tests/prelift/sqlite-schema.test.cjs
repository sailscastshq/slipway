// Native database fixtures only; no Sails lift, ORM, application jobs or credentials.
const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const Database = require('better-sqlite3')
const readSchema = require('../../api/lib/sqlite-schema')

function fixture(t) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'native-catalog-'))
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }))
  return path.join(directory, 'app.db')
}

test('pre-ORM catalog preserves physical constraints, generated columns and native objects without writing', (t) => {
  assert.equal(global.sails, undefined)
  const filename = fixture(t)
  const db = new Database(filename)
  db.exec(`
    CREATE TABLE parents (id INTEGER PRIMARY KEY);
    CREATE TABLE items (
      id INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL,
      title TEXT NOT NULL DEFAULT 'untitled' CHECK(length(title) > 0),
      parent INTEGER REFERENCES parents(id) ON DELETE SET NULL,
      length INTEGER GENERATED ALWAYS AS (length(title)) STORED
    );
    CREATE UNIQUE INDEX items_title ON items(lower(title) COLLATE NOCASE DESC) WHERE title <> '';
    CREATE TABLE edits (title TEXT);
    CREATE TRIGGER item_edits AFTER UPDATE ON items BEGIN INSERT INTO edits VALUES(NEW.title); END;
    CREATE VIEW item_titles AS SELECT title FROM items;
    INSERT INTO items(title) VALUES('preserved');
  `)
  db.close()
  const before = fs.readFileSync(filename)
  const result = readSchema({ path: filename })
  assert.equal(result.error, undefined)
  const table = result.tables.items
  assert.equal(table.catalogComplete, true)
  assert.match(table.sql, /CHECK\(length\(title\) > 0\)/)
  assert.equal(table.columns.find((c) => c.name === 'title').nullable, false)
  assert.equal(
    table.columns.find((c) => c.name === 'title').defaultValue,
    "'untitled'"
  )
  assert.equal(table.columns.find((c) => c.name === 'length').generated, true)
  assert.equal(table.columns.find((c) => c.name === 'id').autoIncrement, true)
  const index = table.indexes.find((i) => i.name === 'items_title')
  assert.equal(index.unique, true)
  assert.equal(index.partial, true)
  assert.equal(index.definition[0].descending, true)
  assert.equal(index.definition[0].collation, 'NOCASE')
  assert.match(index.sql, /lower\(title\)/)
  assert.equal(table.foreignKeys[0].onDelete, 'SET NULL')
  assert.equal(table.triggers[0].name, 'item_edits')
  assert.equal(table.views[0].name, 'item_titles')
  assert.deepEqual(readSchema({ path: filename }), result)
  assert.deepEqual(fs.readFileSync(filename), before)
  const verify = new Database(filename, { readonly: true })
  assert.equal(
    verify.prepare('SELECT title FROM items').get().title,
    'preserved'
  )
  assert.equal(verify.prepare('SELECT count(*) AS n FROM edits').get().n, 0)
  verify.close()
})

test('catalog reads use and retain the caller-owned transaction, including uncommitted schema', (t) => {
  const filename = fixture(t)
  const db = new Database(filename)
  t.after(() => {
    if (db.open) db.close()
  })
  db.exec(
    'CREATE TABLE records (id INTEGER PRIMARY KEY); BEGIN IMMEDIATE; ALTER TABLE records ADD COLUMN pending TEXT;'
  )
  const result = readSchema({ path: filename, transaction: { database: db } })
  assert.equal(result.error, undefined)
  assert.ok(result.tables.records.columns.some((c) => c.name === 'pending'))
  assert.equal(db.open, true)
  assert.equal(db.inTransaction, true)
  db.exec('ROLLBACK')
  assert.equal(
    readSchema({ path: filename }).tables.records.columns.some(
      (c) => c.name === 'pending'
    ),
    false
  )
})

test('missing and corrupt databases fail without creating or replacing files', (t) => {
  const filename = fixture(t)
  assert.match(readSchema({ path: filename }).error, /not found/)
  assert.equal(fs.existsSync(filename), false)
  fs.writeFileSync(filename, 'not a SQLite database')
  const before = fs.readFileSync(filename)
  assert.equal(Object.keys(readSchema({ path: filename }).tables).length, 0)
  assert.ok(readSchema({ path: filename }).error)
  assert.deepEqual(fs.readFileSync(filename), before)
})
