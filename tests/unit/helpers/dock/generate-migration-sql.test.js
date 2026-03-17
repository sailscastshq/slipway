const { test } = require('sounding')

const generateMigrationSql = require('../../../../api/helpers/dock/generate-migration-sql')

test('sqlite migration SQL rebuilds tables for modified columns', async ({
  expect
}) => {
  const result = await generateMigrationSql.fn({
    dbType: 'sqlite',
    diff: {
      tablesToCreate: [],
      tablesToDrop: [],
      columnsToAdd: [],
      columnsToModify: [
        {
          tableName: 'users',
          columnName: 'is_genesis_user',
          current: {
            type: 'text'
          },
          expected: {
            sqlType: 'INTEGER'
          }
        }
      ],
      columnsToDrop: [],
      indexesToCreate: []
    },
    models: {
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
    schema: {
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
  })

  expect(result.statements.length).toBe(1)
  expect(result.statements[0].type).toBe('rebuild_table')
  expect(result.statements[0].sql).toContain(
    'ALTER TABLE `users` RENAME TO `users__old`;'
  )
  expect(result.statements[0].sql).toContain(
    'CREATE TABLE IF NOT EXISTS `users`'
  )
  expect(result.statements[0].sql).toContain(
    '`is_genesis_user` INTEGER DEFAULT 0'
  )
  expect(result.statements[0].sql).toContain(
    'INSERT INTO `users` (`id`, `created_at`, `updated_at`, `email`, `is_genesis_user`)'
  )
  expect(result.statements[0].sql).toContain(
    'CREATE UNIQUE INDEX IF NOT EXISTS `idx_users_email`'
  )
})
