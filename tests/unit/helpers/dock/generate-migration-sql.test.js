const { test } = require('sounding')

test('sqlite migration SQL preserves the original table contract and schema objects', async ({
  sails,
  expect
}) => {
  const result = await sails.helpers.dock.generateMigrationSql(
    {
      tablesToCreate: [],
      tablesToDrop: [],
      columnsToRename: [],
      columnsToAdd: [],
      columnsToModify: [
        {
          tableName: 'users',
          columnName: 'email',
          current: {
            type: 'integer'
          },
          expected: {
            sqlType: 'TEXT'
          }
        }
      ],
      columnsToDrop: [],
      indexesToCreate: []
    },
    'sqlite',
    {
      user: {
        identity: 'user',
        tableName: 'users',
        primaryKey: 'id',
        attributes: {
          id: {
            type: 'number',
            autoIncrement: true
          },
          createdAt: {
            type: 'number',
            autoCreatedAt: true,
            columnName: 'created_at'
          },
          updatedAt: {
            type: 'number',
            autoUpdatedAt: true,
            columnName: 'updated_at'
          },
          email: {
            type: 'string',
            unique: true
          },
          isGenesisUser: {
            type: 'boolean',
            defaultsTo: false,
            columnName: 'is_genesis_user'
          }
        }
      }
    },
    {
      users: {
        columns: [
          { name: 'id' },
          { name: 'created_at' },
          { name: 'updated_at' },
          { name: 'email' },
          { name: 'is_genesis_user' }
        ],
        sql: `CREATE TABLE "users" (
          "id" INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL,
          "created_at" INTEGER,
          "updated_at" INTEGER,
          "email" INTEGER NOT NULL COLLATE NOCASE CHECK (length("email") > 3),
          "is_genesis_user" INTEGER NOT NULL DEFAULT 0,
          CONSTRAINT "users_email_genesis_unique" UNIQUE ("email", "is_genesis_user")
        ) STRICT`,
        indexes: [
          {
            name: 'users_email_search',
            origin: 'c',
            sql: `CREATE INDEX "users_email_search" ON "users" (lower("email") DESC) WHERE "is_genesis_user" = 0`
          },
          {
            name: 'sqlite_autoindex_users_1',
            origin: 'u',
            sql: null
          }
        ],
        triggers: [
          {
            name: 'users_email_audit',
            sql: `CREATE TRIGGER "users_email_audit" AFTER UPDATE OF "email" ON "users" BEGIN SELECT NEW."email"; END`
          }
        ],
        views: [
          {
            name: 'active_users',
            sql: `CREATE VIEW "active_users" AS SELECT * FROM "users"`
          }
        ]
      }
    }
  )

  expect(result.statements.length).toBe(1)
  expect(result.statements[0].type).toBe('rebuild_table')
  expect(result.statements[0].risk).toBe('high')
  expect(result.statements[0].sql).toContain(
    'CREATE TABLE `users__slipway_new`'
  )
  expect(result.statements[0].sql.includes('IF NOT EXISTS')).toBe(false)
  expect(result.statements[0].sql).toContain(
    '"email" TEXT NOT NULL COLLATE NOCASE CHECK (length("email") > 3)'
  )
  expect(result.statements[0].sql).toContain(
    'CONSTRAINT "users_email_genesis_unique" UNIQUE ("email", "is_genesis_user")'
  )
  expect(result.statements[0].sql).toContain(') STRICT;')
  expect(result.statements[0].sql).toContain(
    'INSERT INTO `users__slipway_new` (`id`, `created_at`, `updated_at`, `email`, `is_genesis_user`) SELECT `id`, `created_at`, `updated_at`, `email`, `is_genesis_user` FROM `users`;'
  )
  expect(result.statements[0].sql).toContain(
    'CREATE INDEX "users_email_search" ON "users" (lower("email") DESC) WHERE "is_genesis_user" = 0;'
  )
  expect(result.statements[0].sql).toContain(
    'CREATE TRIGGER "users_email_audit" AFTER UPDATE OF "email" ON "users"'
  )
  expect(result.statements[0].preservedObjects).toEqual([
    { type: 'index', name: 'users_email_search' },
    { type: 'unique constraint', name: 'sqlite_autoindex_users_1' },
    { type: 'trigger', name: 'users_email_audit' },
    { type: 'view', name: 'active_users' }
  ])
  expect(result.statements[0].verification).toEqual({
    rowCount: true,
    integrityCheck: true,
    foreignKeyCheck: true
  })
})

test('sqlite migration SQL renames camelCase columns without rebuilding tables', async ({
  sails,
  expect
}) => {
  const result = await sails.helpers.dock.generateMigrationSql(
    {
      tablesToCreate: [],
      tablesToDrop: [],
      columnsToRename: [
        {
          tableName: 'apps',
          fromColumnName: 'dockerfilePath',
          toColumnName: 'dockerfile_path'
        }
      ],
      columnsToAdd: [],
      columnsToModify: [],
      columnsToDrop: [],
      indexesToCreate: []
    },
    'sqlite',
    {},
    {}
  )

  expect(result.statements).toEqual([
    {
      type: 'rename_column',
      table: 'apps',
      column: 'dockerfile_path',
      fromColumn: 'dockerfilePath',
      sql: 'ALTER TABLE `apps` RENAME COLUMN `dockerfilePath` TO `dockerfile_path`;'
    }
  ])
})

test('sqlite table rebuild fails closed when combined with a column rename', async ({
  sails,
  expect
}) => {
  const result = await sails.helpers.dock.generateMigrationSql(
    {
      tablesToCreate: [],
      tablesToDrop: [],
      columnsToRename: [
        {
          tableName: 'apps',
          fromColumnName: 'dockerfilePath',
          toColumnName: 'dockerfile_path'
        }
      ],
      columnsToAdd: [],
      columnsToModify: [
        {
          tableName: 'apps',
          columnName: 'name',
          current: {
            type: 'integer'
          },
          expected: {
            sqlType: 'TEXT'
          }
        }
      ],
      columnsToDrop: [],
      indexesToCreate: []
    },
    'sqlite',
    {
      app: {
        identity: 'app',
        tableName: 'apps',
        primaryKey: 'id',
        attributes: {
          id: {
            type: 'number',
            autoIncrement: true
          },
          name: {
            type: 'string'
          },
          dockerfilePath: {
            type: 'string',
            columnName: 'dockerfile_path'
          }
        }
      }
    },
    {
      apps: {
        sql: 'CREATE TABLE `apps` (`id` INTEGER PRIMARY KEY, `name` INTEGER, `dockerfilePath` TEXT)',
        columns: [{ name: 'id' }, { name: 'name' }, { name: 'dockerfilePath' }],
        indexes: [],
        triggers: [],
        views: []
      }
    }
  )

  expect(result.statements.length).toBe(1)
  expect(result.statements[0].type).toBe('blocked_rebuild')
  expect(result.statements[0].table).toBe('apps')
  expect(result.statements[0].blocked).toBe(true)
  expect(result.statements[0].risk).toBe('blocked')
  expect(result.statements[0].reason).toContain('column renames')
})
