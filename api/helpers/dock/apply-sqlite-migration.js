const Database = require('better-sqlite3')

module.exports = {
  friendlyName: 'Apply SQLite migration',

  description:
    'Apply SQLite schema statements atomically and verify rebuild integrity before commit.',

  inputs: {
    databasePath: {
      type: 'string',
      required: true
    },
    statements: {
      type: 'ref',
      required: true
    }
  },

  exits: {
    success: {
      outputType: 'ref'
    }
  },

  fn: async function ({ databasePath, statements }) {
    let db
    const results = []
    let foreignKeysWereEnabled = false

    try {
      db = new Database(databasePath, { fileMustExist: true })
      const rebuildStatements = statements.filter(
        (statement) => statement.type === 'rebuild_table'
      )
      const rowCountsBefore = new Map()

      for (const statement of rebuildStatements) {
        const row = db
          .prepare(
            `SELECT COUNT(*) AS count FROM ${quoteSqliteIdentifier(
              statement.table
            )}`
          )
          .get()
        rowCountsBefore.set(statement.table, row.count)
      }

      foreignKeysWereEnabled = Boolean(
        db.pragma('foreign_keys', { simple: true })
      )
      if (rebuildStatements.length > 0) {
        db.pragma('foreign_keys = OFF')
      }

      db.exec('BEGIN IMMEDIATE;')

      for (const statement of statements) {
        db.exec(statement.sql)
        results.push({
          sql: statement.sql,
          success: true,
          message: 'OK'
        })
      }

      for (const statement of rebuildStatements) {
        verifySqliteRebuild(db, statement, rowCountsBefore.get(statement.table))
      }

      db.exec('COMMIT;')

      return {
        success: true,
        executed: statements.length,
        failed: 0,
        results
      }
    } catch (error) {
      try {
        db?.exec('ROLLBACK;')
      } catch {
        // Ignore rollback failures when no transaction is open.
      }

      return {
        success: false,
        executed: 0,
        failed: 1,
        results: [
          ...results.map((result) => ({
            ...result,
            success: false,
            rolledBack: true,
            message: 'Rolled back'
          })),
          {
            sql: null,
            success: false,
            error: error.message
          }
        ]
      }
    } finally {
      if (db) {
        if (foreignKeysWereEnabled) {
          db.pragma('foreign_keys = ON')
        }
        db.close()
      }
    }
  }
}

function verifySqliteRebuild(db, statement, rowCountBefore) {
  const rowCountAfter = db
    .prepare(
      `SELECT COUNT(*) AS count FROM ${quoteSqliteIdentifier(statement.table)}`
    )
    .get().count

  if (rowCountAfter !== rowCountBefore) {
    throw new Error(
      `Row-count verification failed for ${statement.table}: expected ${rowCountBefore}, found ${rowCountAfter}.`
    )
  }

  const integrity = db.pragma('integrity_check')
  if (
    integrity.length !== 1 ||
    String(integrity[0].integrity_check).toLowerCase() !== 'ok'
  ) {
    throw new Error(
      `SQLite integrity verification failed: ${integrity
        .map((row) => row.integrity_check)
        .join('; ')}`
    )
  }

  const foreignKeyFailures = db.pragma('foreign_key_check')
  if (foreignKeyFailures.length > 0) {
    throw new Error(
      `SQLite foreign-key verification found ${foreignKeyFailures.length} violation(s).`
    )
  }

  for (const object of statement.preservedObjects || []) {
    if (object.type === 'unique constraint') continue

    const schemaType = object.type === 'view' ? 'view' : object.type
    const exists = db
      .prepare('SELECT 1 FROM sqlite_schema WHERE type = ? AND name = ?')
      .get(schemaType, object.name)

    if (!exists) {
      throw new Error(
        `SQLite ${object.type} verification failed: ${object.name} was not preserved.`
      )
    }
  }
}

function quoteSqliteIdentifier(value) {
  return `\`${String(value).replace(/`/g, '``')}\``
}
