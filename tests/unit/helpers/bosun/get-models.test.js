const { test } = require('sounding')

test('bosun model discovery only returns models for the selected datastore', async ({
  sails,
  expect
}) => {
  const originalModels = sails.models
  const originalGetDatabaseService = sails.helpers.bosun.getDatabaseService

  try {
    sails.helpers.bosun.getDatabaseService = async () => ({
      datastore: 'observability'
    })

    sails.models = {
      user: {
        identity: 'user',
        tableName: 'users',
        attributes: {
          email: {
            type: 'string'
          }
        }
      },
      telemetrymetric: {
        identity: 'telemetrymetric',
        datastore: 'observability',
        tableName: 'telemetry_metrics',
        primaryKey: 'id',
        schema: {
          id: {
            columnName: 'id'
          },
          name: {
            columnName: 'metric_name'
          },
          environment: {
            columnName: 'environment'
          },
          recordedAt: {
            columnName: 'recorded_at'
          },
          isPublished: {
            columnName: 'is_published'
          }
        },
        attributes: {
          id: {
            type: 'number',
            autoMigrations: { autoIncrement: true }
          },
          name: {
            type: 'string'
          },
          environment: {
            type: 'string'
          },
          recordedAt: {
            type: 'number',
            autoCreatedAt: true
          },
          isPublished: {
            type: 'boolean',
            autoMigrations: { columnType: '_boolean' },
            defaultsTo: false
          },
          spans: {
            collection: 'telemetryspan',
            via: 'metric'
          }
        }
      }
    }

    const result = await sails.helpers.bosun.getModels('observability')

    expect(result.datastore).toBe('observability')
    expect(result.modelCount).toBe(1)
    expect(Object.keys(result.models)).toEqual(['telemetrymetric'])
    expect(result.models.telemetrymetric.attributes).toEqual({
      id: {
        type: 'number',
        columnType: undefined,
        columnName: 'id',
        required: false,
        unique: false,
        index: false,
        defaultsTo: undefined,
        autoCreatedAt: false,
        autoUpdatedAt: false,
        autoIncrement: true,
        allowNull: undefined
      },
      name: {
        type: 'string',
        columnType: undefined,
        columnName: 'metric_name',
        required: false,
        unique: false,
        index: false,
        defaultsTo: undefined,
        autoCreatedAt: false,
        autoUpdatedAt: false,
        autoIncrement: false,
        allowNull: undefined
      },
      environment: {
        type: 'string',
        columnType: undefined,
        columnName: 'environment',
        required: false,
        unique: false,
        index: false,
        defaultsTo: undefined,
        autoCreatedAt: false,
        autoUpdatedAt: false,
        autoIncrement: false,
        allowNull: undefined
      },
      recordedAt: {
        type: 'number',
        columnType: undefined,
        columnName: 'recorded_at',
        required: false,
        unique: false,
        index: false,
        defaultsTo: undefined,
        autoCreatedAt: true,
        autoUpdatedAt: false,
        autoIncrement: false,
        allowNull: undefined
      },
      isPublished: {
        type: 'boolean',
        columnType: '_boolean',
        columnName: 'is_published',
        required: false,
        unique: false,
        index: false,
        defaultsTo: false,
        autoCreatedAt: false,
        autoUpdatedAt: false,
        autoIncrement: false,
        allowNull: undefined
      }
    })
  } finally {
    sails.models = originalModels
    sails.helpers.bosun.getDatabaseService = originalGetDatabaseService
  }
})
