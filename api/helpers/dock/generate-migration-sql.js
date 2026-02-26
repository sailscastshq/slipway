/**
 * Generate migration SQL statements from a schema diff.
 *
 * SQL generation follows the same patterns as sails-postgresql and sails-mysql adapters:
 * - PostgreSQL: double-quoted identifiers, SERIAL for auto-increment
 * - MySQL: backtick-quoted identifiers, AUTO_INCREMENT flag
 */

module.exports = {
  friendlyName: 'Generate migration SQL',

  description: 'Generate SQL statements from a schema diff.',

  inputs: {
    diff: {
      type: 'ref',
      required: true,
      description: 'Schema diff from generate-diff'
    },
    dbType: {
      type: 'string',
      required: true,
      isIn: ['postgresql', 'mysql', 'mongodb'],
      description: 'Database type'
    }
  },

  exits: {
    success: {
      description: 'SQL statements generated',
      outputType: 'ref'
    }
  },

  fn: async function ({ diff, dbType }) {
    const statements = []

    // MongoDB: generate createCollection commands
    if (dbType === 'mongodb') {
      for (const table of diff.tablesToCreate) {
        // Use createCollection which is idempotent-ish (throws error if exists, but we can handle that)
        // We wrap in try-catch so it doesn't fail if collection already exists
        const cmd = `db.createCollection('${table.tableName}')`
        statements.push({
          type: 'create_collection',
          table: table.tableName,
          sql: cmd // Using 'sql' key for compatibility with existing code
        })
      }
      return { statements }
    }

    // SQL databases
    const quote = dbType === 'postgresql' ? '"' : '`'

    // Generate CREATE TABLE statements
    for (const table of diff.tablesToCreate) {
      const sql = generateCreateTable(table, dbType, quote)
      statements.push({
        type: 'create_table',
        table: table.tableName,
        sql
      })
    }

    // Generate ADD COLUMN statements
    for (const col of diff.columnsToAdd) {
      const sql = generateAddColumn(col, dbType, quote)
      statements.push({
        type: 'add_column',
        table: col.tableName,
        column: col.columnName,
        sql
      })
    }

    // Generate MODIFY COLUMN statements
    for (const col of diff.columnsToModify) {
      const sql = generateModifyColumn(col, dbType, quote)
      statements.push({
        type: 'modify_column',
        table: col.tableName,
        column: col.columnName,
        sql
      })
    }

    // Generate CREATE INDEX statements
    for (const idx of diff.indexesToCreate) {
      const indexName = `idx_${idx.tableName}_${idx.columnName}`
      const uniqueKeyword = idx.unique ? 'UNIQUE ' : ''
      const sql = `CREATE ${uniqueKeyword}INDEX ${quote}${indexName}${quote} ON ${quote}${idx.tableName}${quote} (${quote}${idx.columnName}${quote});`
      statements.push({
        type: 'create_index',
        table: idx.tableName,
        column: idx.columnName,
        sql
      })
    }

    return { statements }
  }
}

/**
 * Generate CREATE TABLE statement
 * Follows the same pattern as sails-postgresql/mysql define.js
 */
function generateCreateTable(table, dbType, quote) {
  const columnDefs = []
  const primaryKeys = []

  for (const col of table.columns) {
    let def = `${quote}${col.name}${quote} `

    // Handle PostgreSQL SERIAL (auto-increment is in the type itself)
    if (dbType === 'postgresql' && col.autoIncrement) {
      def += 'SERIAL'
    } else if (dbType === 'mysql' && col.autoIncrement) {
      // MySQL: type + AUTO_INCREMENT
      def += col.sqlType
      def += ' AUTO_INCREMENT'
    } else {
      def += col.sqlType
    }

    // NOT NULL (unless nullable)
    if (!col.nullable) {
      def += ' NOT NULL'
    }

    // UNIQUE constraint
    if (col.unique && !col.primaryKey) {
      def += ' UNIQUE'
    }

    // Track primary keys
    if (col.primaryKey) {
      primaryKeys.push(col.name)
    }

    columnDefs.push(`  ${def}`)
  }

  // Add PRIMARY KEY constraint at the end (how adapters do it)
  if (primaryKeys.length > 0) {
    const pkCols = primaryKeys.map(pk => `${quote}${pk}${quote}`).join(', ')
    columnDefs.push(`  PRIMARY KEY (${pkCols})`)
  }

  return `CREATE TABLE IF NOT EXISTS ${quote}${table.tableName}${quote} (\n${columnDefs.join(',\n')}\n);`
}

/**
 * Generate ADD COLUMN statement
 */
function generateAddColumn(col, dbType, quote) {
  let sql = `ALTER TABLE ${quote}${col.tableName}${quote} ADD COLUMN ${quote}${col.columnName}${quote} `

  // Handle PostgreSQL SERIAL
  if (dbType === 'postgresql' && col.autoIncrement) {
    sql += 'SERIAL'
  } else if (dbType === 'mysql' && col.autoIncrement) {
    sql += `${col.sqlType} AUTO_INCREMENT`
  } else {
    sql += col.sqlType
  }

  if (!col.nullable) {
    sql += ' NOT NULL'
  }

  if (col.unique) {
    sql += ' UNIQUE'
  }

  if (col.defaultValue !== undefined && col.defaultValue !== null) {
    sql += ` DEFAULT ${formatDefault(col.defaultValue, col.sqlType, dbType)}`
  }

  return sql + ';'
}

/**
 * Generate MODIFY COLUMN statement
 */
function generateModifyColumn(col, dbType, quote) {
  if (dbType === 'postgresql') {
    // PostgreSQL uses ALTER COLUMN ... TYPE
    let sql = `ALTER TABLE ${quote}${col.tableName}${quote} ALTER COLUMN ${quote}${col.columnName}${quote}`
    sql += ` TYPE ${col.expected.sqlType}`

    // Handle nullability change separately in PostgreSQL
    if (col.expected.nullable !== col.current.nullable) {
      sql += `;\nALTER TABLE ${quote}${col.tableName}${quote} ALTER COLUMN ${quote}${col.columnName}${quote}`
      sql += col.expected.nullable ? ' DROP NOT NULL' : ' SET NOT NULL'
    }

    return sql + ';'
  } else {
    // MySQL uses MODIFY COLUMN
    let sql = `ALTER TABLE ${quote}${col.tableName}${quote} MODIFY COLUMN ${quote}${col.columnName}${quote} ${col.expected.sqlType}`

    if (!col.expected.nullable) {
      sql += ' NOT NULL'
    }

    if (col.expected.autoIncrement) {
      sql += ' AUTO_INCREMENT'
    }

    return sql + ';'
  }
}

/**
 * Format default value for SQL
 */
function formatDefault(value, sqlType, dbType) {
  if (value === null || value === undefined) {
    return 'NULL'
  }

  if (typeof value === 'boolean') {
    if (dbType === 'mysql') {
      return value ? '1' : '0'
    }
    return value ? 'TRUE' : 'FALSE'
  }

  if (typeof value === 'number') {
    return String(value)
  }

  if (typeof value === 'string') {
    // Escape single quotes
    return `'${value.replace(/'/g, "''")}'`
  }

  if (typeof value === 'object') {
    // JSON value
    return `'${JSON.stringify(value).replace(/'/g, "''")}'`
  }

  return 'NULL'
}
