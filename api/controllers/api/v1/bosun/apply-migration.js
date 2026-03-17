const Database = require('better-sqlite3')

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

    const service = await sails.helpers.bosun.getDatabaseService(database)
    const sqlStatements = statements.map((statement) =>
      typeof statement === 'string' ? statement : statement.sql
    )

    if (dryRun) {
      return {
        dryRun: true,
        statements: sqlStatements,
        message: 'Dry run complete. No changes made.'
      }
    }

    let db
    const results = []
    let successCount = 0
    let errorCount = 0

    try {
      db = new Database(service.path, { fileMustExist: true })

      for (const sql of sqlStatements) {
        try {
          db.exec(sql)
          successCount++
          results.push({
            sql,
            success: true,
            message: 'OK'
          })
        } catch (error) {
          errorCount++
          try {
            db.exec('ROLLBACK;')
          } catch {
            // Ignore rollback failures when no transaction is open.
          }

          results.push({
            sql,
            success: false,
            error: error.message
          })
          break
        }
      }
    } finally {
      if (db) {
        db.close()
      }
    }

    return {
      success: errorCount === 0,
      executed: successCount,
      failed: errorCount,
      results,
      appliedBy: user.fullName,
      appliedAt: new Date().toISOString()
    }
  }
}
