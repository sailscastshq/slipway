const { test } = require('sounding')

test('schema diff treats old camelCase physical columns as rename candidates', async ({
  sails,
  expect
}) => {
  const diff = await sails.helpers.dock.generateDiff(
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
          dockerfilePath: {
            type: 'string',
            defaultsTo: 'Dockerfile',
            columnName: 'dockerfile_path'
          },
          routePath: {
            type: 'string',
            defaultsTo: '/',
            columnName: 'route_path'
          },
          envVars: {
            type: 'json',
            defaultsTo: {},
            columnName: 'app_env_vars'
          }
        }
      }
    },
    {
      apps: {
        columns: [
          { name: 'id', type: 'integer' },
          { name: 'createdAt', type: 'integer' },
          { name: 'updatedAt', type: 'integer' },
          { name: 'dockerfilePath', type: 'text' },
          { name: 'routePath', type: 'text' },
          { name: 'envVars', type: 'text' }
        ],
        indexes: []
      }
    },
    'sqlite'
  )

  expect(diff.columnsToRename).toEqual([
    {
      tableName: 'apps',
      fromColumnName: 'createdAt',
      toColumnName: 'created_at'
    },
    {
      tableName: 'apps',
      fromColumnName: 'updatedAt',
      toColumnName: 'updated_at'
    },
    {
      tableName: 'apps',
      fromColumnName: 'dockerfilePath',
      toColumnName: 'dockerfile_path'
    },
    {
      tableName: 'apps',
      fromColumnName: 'routePath',
      toColumnName: 'route_path'
    },
    {
      tableName: 'apps',
      fromColumnName: 'envVars',
      toColumnName: 'app_env_vars'
    }
  ])
  expect(diff.columnsToAdd).toEqual([])
})

test('schema diff treats SQLite boolean storage forms as one logical contract', async ({
  sails,
  expect
}) => {
  const diff = await sails.helpers.dock.generateDiff(
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
          isDefault: {
            type: 'boolean',
            columnName: 'is_default',
            columnType: '_boolean',
            defaultsTo: true
          },
          bridgeEnabled: {
            type: 'boolean',
            columnName: 'bridge_enabled',
            defaultsTo: false
          }
        }
      },
      featureFlag: {
        identity: 'featureFlag',
        tableName: 'feature_flags',
        primaryKey: 'id',
        attributes: {
          id: {
            type: 'number',
            autoIncrement: true
          },
          enabled: {
            type: 'boolean',
            defaultsTo: false
          }
        }
      },
      helmHistoryEntry: {
        identity: 'helmHistoryEntry',
        tableName: 'helm_history_entries',
        primaryKey: 'id',
        attributes: {
          id: {
            type: 'number',
            autoIncrement: true
          },
          pinned: {
            type: 'boolean',
            defaultsTo: false
          }
        }
      },
      project: {
        identity: 'project',
        tableName: 'projects',
        primaryKey: 'id',
        attributes: {
          id: {
            type: 'number',
            autoIncrement: true
          },
          autoDeploy: {
            type: 'boolean',
            columnName: 'auto_deploy',
            defaultsTo: false
          }
        }
      }
    },
    {
      apps: {
        columns: [
          { name: 'id', type: 'integer' },
          { name: 'is_default', type: 'text' },
          { name: 'bridge_enabled', type: 'BOOLEAN' }
        ],
        indexes: []
      },
      feature_flags: {
        columns: [
          { name: 'id', type: 'integer' },
          { name: 'enabled', type: 'INTEGER' }
        ],
        indexes: []
      },
      helm_history_entries: {
        columns: [
          { name: 'id', type: 'integer' },
          { name: 'pinned', type: 'BOOLEAN' }
        ],
        indexes: []
      },
      projects: {
        columns: [
          { name: 'id', type: 'integer' },
          { name: 'auto_deploy', type: 'text' }
        ],
        indexes: []
      }
    },
    'sqlite'
  )

  expect(diff.columnsToModify).toEqual([])
})
