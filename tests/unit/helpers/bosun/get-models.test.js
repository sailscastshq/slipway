const { test } = require('sounding')

const getModels = require('../../../../api/helpers/bosun/get-models')

const originalSails = global.sails

test('bosun model discovery only returns models for the selected datastore', async ({
  expect
}) => {
  try {
    global.sails = {
      helpers: {
        bosun: {
          getDatabaseService: async () => ({ datastore: 'observability' })
        }
      },
      models: {
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
            spans: {
              collection: 'telemetryspan',
              via: 'metric'
            }
          }
        }
      }
    }

    const result = await getModels.fn({ database: 'observability' })

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
        columnName: 'name',
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
      }
    })
  } finally {
    global.sails = originalSails
  }
})
