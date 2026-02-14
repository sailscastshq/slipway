/**
 * execute-sql.js
 *
 * SQLite REPL endpoint for the Bosun dashboard.
 * Opens Slipway's own SQLite databases in read-only mode
 * and executes SELECT queries against them.
 */

const path = require('path')
const Database = require('better-sqlite3')

module.exports = {
  friendlyName: 'Execute Bosun SQL',

  description: 'Execute a read-only SQL query against a Slipway database.',

  inputs: {
    query: {
      type: 'string',
      required: true,
      description: 'SQL query to execute'
    },
    database: {
      type: 'string',
      defaultsTo: 'app',
      isIn: ['app', 'observability', 'cache'],
      description: 'Which Slipway database to query'
    }
  },

  exits: {
    success: {
      statusCode: 200
    },
    notFound: {
      statusCode: 404
    },
    forbidden: {
      statusCode: 403,
      description: 'Destructive query blocked'
    },
    badRequest: {
      responseType: 'badRequest'
    }
  },

  fn: async function ({ query, database }) {
    const user = await User.findOne({ id: this.req.session.userId }).populate('team')
    if (!user) {
      throw 'notFound'
    }

    // Trim and validate the query
    const trimmedQuery = query.trim()
    if (!trimmedQuery) {
      throw { badRequest: 'Query cannot be empty.' }
    }

    // Block destructive operations
    const destructivePatterns = [
      /^\s*INSERT\s/i,
      /^\s*UPDATE\s/i,
      /^\s*DELETE\s/i,
      /^\s*DROP\s/i,
      /^\s*ALTER\s/i,
      /^\s*CREATE\s/i,
      /^\s*TRUNCATE\s/i,
      /^\s*REPLACE\s/i,
      /^\s*ATTACH\s/i,
      /^\s*DETACH\s/i,
      /^\s*REINDEX\s/i,
      /^\s*VACUUM\s/i
    ]

    for (const pattern of destructivePatterns) {
      if (pattern.test(trimmedQuery)) {
        throw { forbidden: 'Only read-only queries (SELECT, PRAGMA, EXPLAIN) are allowed in the Bosun console.' }
      }
    }

    // Map database name to file path
    const dbPaths = {
      app: path.resolve(sails.config.appPath, 'db/app.db'),
      observability: path.resolve(sails.config.appPath, 'db/observability.db'),
      cache: path.resolve(sails.config.appPath, 'db/stash.db')
    }

    const dbPath = dbPaths[database]
    if (!dbPath) {
      throw { badRequest: 'Unknown database.' }
    }

    let db
    try {
      // Open in read-only mode for safety
      db = new Database(dbPath, { readonly: true })

      const startTime = Date.now()
      const stmt = db.prepare(trimmedQuery)
      let rows, columns

      // PRAGMA and SELECT both return data; detect via stmt.reader
      if (stmt.reader) {
        rows = stmt.all()
        columns = rows.length > 0 ? Object.keys(rows[0]) : stmt.columns().map(c => c.name)
      } else {
        // Non-reader statement (shouldn't reach here due to blocking above, but just in case)
        throw { forbidden: 'Only read-only queries are allowed.' }
      }

      const durationMs = Date.now() - startTime

      return {
        columns,
        rows: rows.slice(0, 1000),
        rowCount: rows.length,
        truncated: rows.length > 1000,
        durationMs
      }
    } catch (err) {
      if (err.code === 'SQLITE_ERROR' || err.message?.includes('SQLITE')) {
        throw { badRequest: err.message }
      }
      // Re-throw exit signals
      if (typeof err === 'string' || err.forbidden || err.badRequest) {
        throw err
      }
      throw { badRequest: err.message || 'Query execution failed.' }
    } finally {
      if (db) {
        try { db.close() } catch { /* ignore */ }
      }
    }
  }
}
