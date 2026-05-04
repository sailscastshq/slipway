const { test } = require('sounding')

test('sqlite migration SQL rebuilds tables for modified columns', async ({
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
        ]
      }
    }
  )

  expect(result.statements.length).toBe(1)
  expect(result.statements[0].type).toBe('rebuild_table')
  expect(result.statements[0].sql).toContain(
    'ALTER TABLE `users` RENAME TO `users__old`;'
  )
  expect(result.statements[0].sql).toContain(
    'CREATE TABLE IF NOT EXISTS `users`'
  )
  expect(result.statements[0].sql).toContain('`is_genesis_user` TEXT DEFAULT 0')
  expect(result.statements[0].sql).toContain(
    'INSERT INTO `users` (`id`, `created_at`, `updated_at`, `email`, `is_genesis_user`)'
  )
  expect(result.statements[0].sql).toContain(
    'CREATE UNIQUE INDEX IF NOT EXISTS `idx_users_email`'
  )
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

test('sqlite table rebuild copies data from renamed source columns', async ({
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
        columns: [{ name: 'id' }, { name: 'name' }, { name: 'dockerfilePath' }]
      }
    }
  )

  expect(result.statements.length).toBe(1)
  expect(result.statements[0].type).toBe('rebuild_table')
  expect(result.statements[0].sql).toContain(
    'INSERT INTO `apps` (`id`, `name`, `dockerfile_path`) SELECT `id`, `name`, `dockerfilePath` FROM `apps__old`;'
  )
})
