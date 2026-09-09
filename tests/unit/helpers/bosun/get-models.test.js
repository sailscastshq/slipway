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
    const attrs = result.models.telemetrymetric.attributes
    expect(attrs.id.autoIncrement).toBe(true)
    expect(attrs.id.primaryKey).toBe(true)
    expect(attrs.name.columnName).toBe('metric_name')
    expect(attrs.recordedAt.autoCreatedAt).toBe(true)
    expect(attrs.isPublished.columnType).toBe('_boolean')
    expect(attrs.isPublished.defaultsTo).toBe(false)
    expect(attrs.spans).toBe(undefined)
    expect(result.authoritative).toBe(true)
  } finally {
    sails.models = originalModels
    sails.helpers.bosun.getDatabaseService = originalGetDatabaseService
  }
})
