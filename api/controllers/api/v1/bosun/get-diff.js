module.exports = {
  friendlyName: 'Get Bosun schema diff',

  description:
    'Compare Bosun runtime models with the selected internal SQLite database.',

  inputs: {
    database: {
      type: 'string',
      defaultsTo: 'app',
      isIn: ['app', 'observability', 'cache']
    }
  },

  exits: {
    success: {
      statusCode: 200
    },
    notFound: {
      statusCode: 404
    },
    badRequest: {
      statusCode: 400
    }
  },

  fn: async function ({ database }) {
    const user = await User.forRequest(this.req)
    if (!user) {
      throw 'notFound'
    }

    const service = await sails.helpers.bosun.getDatabaseService(database)
    const modelsResult = await sails.helpers.bosun.getModels(database)

    const schemaResult = await sails.helpers.dock.getSchema(service)
    if (schemaResult.error) {
      throw {
        badRequest: {
          error: `Failed to get schema: ${schemaResult.error}`,
          diff: emptyDiff(),
          statements: [],
          hasPendingChanges: false
        }
      }
    }

    if (modelsResult.modelCount === 0) {
      return {
        database,
        databaseType: service.type,
        datastore: modelsResult.datastore,
        modelCount: 0,
        diff: emptyDiff(),
        statements: [],
        hasPendingChanges: false,
        message: `No Waterline models use the ${database} datastore.`
      }
    }

    const diff = await sails.helpers.dock.generateDiff(
      modelsResult.models,
      schemaResult.tables,
      service.type
    )

    const { statements } = await sails.helpers.dock.generateMigrationSql(
      diff,
      service.type,
      modelsResult.models,
      schemaResult.tables
    )

    const blocked = statements.filter((item) => item.blocked)
    return {
      database,
      databaseType: service.type,
      datastore: modelsResult.datastore,
      modelCount: modelsResult.modelCount,
      diff,
      state: blocked.length ? 'unverified' : diff.state,
      verification: {
        unsupported: blocked.length
          ? blocked.map((item) => ({
              tableName: item.table || 'Migration',
              columnName: item.column,
              reason: item.reason
            }))
          : diff.unsupported || [],
        preservedObjects: diff.preserved?.length || 0
      },
      statements,
      hasPendingChanges: statements.length > 0,
      hasBlockedChanges: statements.some((statement) => statement.blocked)
    }
  }
}

function emptyDiff() {
  return {
    tablesToCreate: [],
    tablesToDrop: [],
    columnsToRename: [],
    columnsToAdd: [],
    columnsToModify: [],
    columnsToDrop: [],
    indexesToCreate: []
  }
}
