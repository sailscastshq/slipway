const fs = require('fs')
const os = require('os')
const path = require('path')
const Database = require('better-sqlite3')
const { test } = require('sounding')

test('Bosun considers Slipway SQLite boolean schemas idempotent', async ({
  sails,
  expect
}) => {
  await withDatabase(async (databasePath) => {
    const db = new Database(databasePath)
    db.exec(`
      CREATE TABLE apps (
        id INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL,
        bridge_enabled BOOLEAN NOT NULL DEFAULT 0
      );
      CREATE TABLE feature_flags (
        id INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL,
        enabled INTEGER NOT NULL DEFAULT 0
      );
      CREATE INDEX feature_flags_app_key ON feature_flags (enabled, id);
      CREATE INDEX feature_flags_environment_updated ON feature_flags (id DESC) WHERE enabled = 1;
      CREATE TABLE helm_history_entries (
        id INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL,
        pinned BOOLEAN NOT NULL DEFAULT 0
      );
      CREATE INDEX helm_history_scope ON helm_history_entries (pinned, id);
      CREATE INDEX helm_history_retention ON helm_history_entries (id DESC) WHERE pinned = 0;
    `)
    db.close()

    const schema = await sails.helpers.dock.getSchema({
      type: 'sqlite',
      path: databasePath
    })
    const models = booleanModels()
    const diff = await sails.helpers.dock.generateDiff(
      models,
      schema.tables,
      'sqlite'
    )
    const migration = await sails.helpers.dock.generateMigrationSql(
      diff,
      'sqlite',
      models,
      schema.tables
    )

    expect(diff.columnsToModify).toEqual([])
    expect(migration.statements).toEqual([])
    expect(
      schema.tables.feature_flags.indexes.map((index) => index.name)
    ).toEqual(['feature_flags_environment_updated', 'feature_flags_app_key'])
    expect(
      schema.tables.feature_flags.indexes.find(
        (index) => index.name === 'feature_flags_environment_updated'
      ).partial
    ).toBe(true)
  })
})

test('verified SQLite rebuild preserves rows, constraints, indexes, triggers, views, and foreign keys', async ({
  sails,
  expect
}) => {
  await withDatabase(async (databasePath) => {
    const db = new Database(databasePath)
    db.exec(`
      PRAGMA foreign_keys = ON;
      CREATE TABLE teams (
        id INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL,
        name TEXT NOT NULL UNIQUE
      );
      CREATE TABLE widgets (
        id INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL,
        team_id INTEGER NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
        state INTEGER NOT NULL DEFAULT 0 CHECK (state IN (0, 1)),
        slug TEXT NOT NULL,
        UNIQUE (team_id, slug)
      );
      CREATE INDEX widgets_active_slug ON widgets (lower(slug) DESC) WHERE state = 1;
      CREATE TRIGGER widgets_slug_guard BEFORE UPDATE OF slug ON widgets
      BEGIN
        SELECT CASE WHEN NEW.slug = '' THEN RAISE(ABORT, 'slug required') END;
      END;
      CREATE VIEW active_widgets AS SELECT id, slug FROM widgets WHERE state = 1;
      INSERT INTO teams (name) VALUES ('Slipway');
      INSERT INTO widgets (team_id, state, slug) VALUES (1, 1, 'bearing'), (1, 0, 'bridge');
    `)
    db.close()

    const schemaBefore = await sails.helpers.dock.getSchema({
      type: 'sqlite',
      path: databasePath
    })
    const diff = {
      tablesToCreate: [],
      tablesToDrop: [],
      columnsToRename: [],
      columnsToAdd: [],
      columnsToModify: [
        {
          tableName: 'widgets',
          columnName: 'state',
          current: { type: 'INTEGER' },
          expected: { sqlType: 'TEXT' }
        }
      ],
      columnsToDrop: [],
      indexesToCreate: []
    }
    const migration = await sails.helpers.dock.generateMigrationSql(
      diff,
      'sqlite',
      {
        widget: {
          identity: 'widget',
          tableName: 'widgets',
          primaryKey: 'id',
          attributes: {}
        }
      },
      schemaBefore.tables
    )
    const result = await sails.helpers.dock.applySqliteMigration(
      databasePath,
      migration.statements
    )

    if (!result.success) {
      throw new Error(JSON.stringify(result.results, null, 2))
    }
    expect(result.success).toBe(true)

    const migrated = new Database(databasePath)
    const tableSql = migrated
      .prepare(
        "SELECT sql FROM sqlite_schema WHERE type = 'table' AND name = 'widgets'"
      )
      .get().sql
    expect(tableSql).toContain(
      'state TEXT NOT NULL DEFAULT 0 CHECK (state IN (0, 1))'
    )
    expect(
      migrated.prepare('SELECT COUNT(*) AS count FROM widgets').get().count
    ).toBe(2)
    expect(
      migrated
        .prepare(
          "SELECT COUNT(*) AS count FROM sqlite_schema WHERE name IN ('widgets_active_slug', 'widgets_slug_guard', 'active_widgets')"
        )
        .get().count
    ).toBe(3)
    expect(migrated.pragma('foreign_key_check')).toEqual([])
    expect(migrated.pragma('integrity_check')).toEqual([
      { integrity_check: 'ok' }
    ])
    migrated.close()
  })
})

test('SQLite rebuild verification rolls the whole migration back on row loss', async ({
  sails,
  expect
}) => {
  await withDatabase(async (databasePath) => {
    const db = new Database(databasePath)
    db.exec(`
      CREATE TABLE widgets (id INTEGER PRIMARY KEY, state INTEGER NOT NULL DEFAULT 0);
      INSERT INTO widgets (id, state) VALUES (1, 0), (2, 1);
    `)
    db.close()

    const schema = await sails.helpers.dock.getSchema({
      type: 'sqlite',
      path: databasePath
    })
    const migration = await sails.helpers.dock.generateMigrationSql(
      {
        tablesToCreate: [],
        tablesToDrop: [],
        columnsToRename: [],
        columnsToAdd: [],
        columnsToModify: [
          {
            tableName: 'widgets',
            columnName: 'state',
            current: { type: 'INTEGER' },
            expected: { sqlType: 'TEXT' }
          }
        ],
        columnsToDrop: [],
        indexesToCreate: []
      },
      'sqlite',
      {
        widget: {
          identity: 'widget',
          tableName: 'widgets',
          primaryKey: 'id',
          attributes: {}
        }
      },
      schema.tables
    )
    migration.statements[0].sql = migration.statements[0].sql.replace(
      'SELECT `id`, `state` FROM `widgets`;',
      'SELECT `id`, `state` FROM `widgets` WHERE `id` = 1;'
    )

    const result = await sails.helpers.dock.applySqliteMigration(
      databasePath,
      migration.statements
    )

    expect(result.success).toBe(false)
    expect(result.results.at(-1).error).toContain(
      'Row-count verification failed'
    )

    const rolledBack = new Database(databasePath)
    expect(
      rolledBack.prepare('SELECT COUNT(*) AS count FROM widgets').get().count
    ).toBe(2)
    expect(
      rolledBack
        .prepare(
          "SELECT type FROM pragma_table_info('widgets') WHERE name = 'state'"
        )
        .get().type
    ).toBe('INTEGER')
    rolledBack.close()
  })
})

function booleanModels() {
  return {
    app: model('app', 'apps', 'bridge_enabled'),
    featureFlag: model('featureFlag', 'feature_flags', 'enabled'),
    helmHistoryEntry: model(
      'helmHistoryEntry',
      'helm_history_entries',
      'pinned'
    )
  }
}

function model(identity, tableName, booleanColumn) {
  return {
    identity,
    tableName,
    primaryKey: 'id',
    attributes: {
      id: { type: 'number', autoIncrement: true },
      [booleanColumn]: {
        type: 'boolean',
        columnName: booleanColumn,
        defaultsTo: false
      }
    }
  }
}

async function withDatabase(fn) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'slipway-schema-'))
  const databasePath = path.join(directory, 'test.sqlite')

  try {
    new Database(databasePath).close()
    await fn(databasePath)
  } finally {
    fs.rmSync(directory, { recursive: true, force: true })
  }
}
