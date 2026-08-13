module.exports = {
  friendlyName: 'Apply Bosun migration',

  description:
    'Execute generated SQLite migration statements against a Bosun database.',

  inputs: {
    database: {
      type: 'string',
      defaultsTo: 'app',
      isIn: ['app', 'observability', 'cache']
    },
    statements: {
      type: 'ref',
      required: true
    },
    dryRun: {
      type: 'boolean',
      defaultsTo: false
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
      responseType: 'badRequest'
    }
  },

  fn: async function ({ database, statements, dryRun }) {
    const user = await User.findOne({ id: this.req.session.userId })
    if (!user) {
      throw 'notFound'
    }

    if (!Array.isArray(statements) || statements.length === 0) {
      throw { badRequest: 'No statements provided.' }
    }

    const requestedTables = new Set(
      statements
        .filter((statement) => statement && typeof statement === 'object')
        .map((statement) => statement.table)
        .filter(Boolean)
    )

    if (requestedTables.size === 0) {
      throw { badRequest: 'Select at least one current schema change.' }
    }

    const service = await sails.helpers.bosun.getDatabaseService(database)
    const modelsResult = await sails.helpers.bosun.getModels(database)
    const schemaResult = await sails.helpers.dock.getSchema(service)

    if (schemaResult.error) {
      throw { badRequest: `Failed to get schema: ${schemaResult.error}` }
    }

    const diff = await sails.helpers.dock.generateDiff(
      modelsResult.models,
      schemaResult.tables,
      service.type
    )
    const generated = await sails.helpers.dock.generateMigrationSql(
      diff,
      service.type,
      modelsResult.models,
      schemaResult.tables
    )
    const migrationStatements = generated.statements.filter(
      (statement) => !statement.table || requestedTables.has(statement.table)
    )

    if (migrationStatements.length === 0) {
      throw {
        badRequest:
          'The selected schema changes are no longer pending. Refresh the migration tab.'
      }
    }
    const blockedStatement = migrationStatements.find(
      (statement) => statement.blocked || statement.type === 'blocked_rebuild'
    )

    if (blockedStatement) {
      throw {
        badRequest:
          blockedStatement.reason ||
          `Bosun blocked the ${blockedStatement.table || 'SQLite'} migration.`
      }
    }

    if (
      migrationStatements.some(
        (statement) => !statement || typeof statement.sql !== 'string'
      )
    ) {
      throw { badRequest: 'Every migration statement must contain SQL.' }
    }

    const sqlStatements = migrationStatements.map((statement) => statement.sql)

    if (dryRun) {
      return {
        dryRun: true,
        statements: sqlStatements,
        message: 'Dry run complete. No changes made.'
      }
    }

    const result = await sails.helpers.dock.applySqliteMigration(
      service.path,
      migrationStatements
    )

    return {
      ...result,
      appliedBy: user.fullName,
      appliedAt: new Date().toISOString()
    }
  }
}
