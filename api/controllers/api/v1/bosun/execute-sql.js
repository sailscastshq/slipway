/**
 * execute-sql.js
 *
 * SQLite REPL endpoint for the Bosun dashboard.
 * Opens Slipway's own SQLite databases and executes
 * SQL queries against them.
 */

const path = require('path')
const Database = require('better-sqlite3')

module.exports = {
  friendlyName: 'Execute Bosun SQL',

  description: 'Execute a SQL query against a Slipway database.',

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
      db = new Database(dbPath)

      const startTime = Date.now()
      const stmt = db.prepare(trimmedQuery)
      let rows, columns

      // PRAGMA and SELECT return rows; write statements return change info
      if (stmt.reader) {
        rows = stmt.all()
        columns = rows.length > 0 ? Object.keys(rows[0]) : stmt.columns().map(c => c.name)
      } else {
        const info = stmt.run()
        rows = [{ changes: info.changes, lastInsertRowid: Number(info.lastInsertRowid) }]
        columns = ['changes', 'lastInsertRowid']
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
