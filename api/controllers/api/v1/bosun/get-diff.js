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
    const user = await User.findOne({ id: this.req.session.userId })
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

    return {
      database,
      databaseType: service.type,
      datastore: modelsResult.datastore,
      modelCount: modelsResult.modelCount,
      diff,
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
