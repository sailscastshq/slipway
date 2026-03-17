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
      isIn: ['postgresql', 'mysql', 'mongodb', 'sqlite'],
      description: 'Database type'
    },
    models: {
      type: 'ref',
      description: 'Resolved model definitions keyed by identity'
    },
    schema: {
      type: 'ref',
      description: 'Current database schema keyed by table name'
    }
  },

  exits: {
    success: {
      description: 'SQL statements generated',
      outputType: 'ref'
    }
  },

  fn: async function ({ diff, dbType, models, schema }) {
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

    if (dbType === 'sqlite') {
      return {
        statements: generateSqliteStatements(diff, models || {}, schema || {})
      }
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

function generateSqliteStatements(diff, models, schema) {
  const statements = []
  const rebuiltTables = new Set()

  for (const table of diff.tablesToCreate) {
    statements.push({
      type: 'create_table',
      table: table.tableName,
      sql: generateCreateTable(table, 'sqlite', '`')
    })

    const model = findModelByTableName(models, table.tableName)
    if (model) {
      statements.push(...generateSqliteIndexStatements(table.tableName, model))
    }
  }

  const tablesToRebuild = new Set(
    diff.columnsToModify.map((column) => column.tableName)
  )

  for (const tableName of tablesToRebuild) {
    const model = findModelByTableName(models, tableName)
    const existingTable = schema[tableName]

    if (!model || !existingTable) {
      continue
    }

    rebuiltTables.add(tableName)
    statements.push({
      type: 'rebuild_table',
      table: tableName,
      sql: generateSqliteTableRebuild(tableName, model, existingTable)
    })
  }

  for (const column of diff.columnsToAdd) {
    if (rebuiltTables.has(column.tableName)) {
      continue
    }

    statements.push({
      type: 'add_column',
      table: column.tableName,
      column: column.columnName,
      sql: generateAddColumn(column, 'sqlite', '`')
    })
  }

  for (const idx of diff.indexesToCreate) {
    if (rebuiltTables.has(idx.tableName)) {
      continue
    }

    const sql = generateSqliteIndexSql(
      idx.tableName,
      idx.columnName,
      idx.unique
    )
    statements.push({
      type: 'create_index',
      table: idx.tableName,
      column: idx.columnName,
      sql
    })
  }

  return statements
}

/**
 * Generate CREATE TABLE statement
 * Follows the same pattern as sails-postgresql/mysql define.js
 */
function generateCreateTable(table, dbType, quote) {
  if (dbType === 'sqlite') {
    return generateSqliteCreateTable(table.tableName, table.columns)
  }

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
    const pkCols = primaryKeys.map((pk) => `${quote}${pk}${quote}`).join(', ')
    columnDefs.push(`  PRIMARY KEY (${pkCols})`)
  }

  return `CREATE TABLE IF NOT EXISTS ${quote}${
    table.tableName
  }${quote} (\n${columnDefs.join(',\n')}\n);`
}

/**
 * Generate ADD COLUMN statement
 */
function generateAddColumn(col, dbType, quote) {
  if (dbType === 'sqlite') {
    let sql = `ALTER TABLE ${quote}${col.tableName}${quote} ADD COLUMN ${quote}${col.columnName}${quote} ${col.sqlType}`

    if (!col.nullable) {
      sql += ' NOT NULL'
    }

    if (col.defaultValue !== undefined && col.defaultValue !== null) {
      sql += ` DEFAULT ${formatDefault(col.defaultValue, col.sqlType, dbType)}`
    }

    return sql + ';'
  }

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

function generateSqliteCreateTable(tableName, columns) {
  const columnDefs = []
  const primaryKeys = []

  for (const column of columns) {
    let def = `\`${column.name}\` `

    if (column.autoIncrement) {
      def += 'INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL'
    } else {
      def += column.sqlType

      if (!column.nullable) {
        def += ' NOT NULL'
      }

      if (column.unique && !column.primaryKey) {
        def += ' UNIQUE'
      }

      if (column.defaultValue !== undefined && column.defaultValue !== null) {
        def += ` DEFAULT ${formatDefault(
          column.defaultValue,
          column.sqlType,
          'sqlite'
        )}`
      }

      if (column.primaryKey) {
        primaryKeys.push(column.name)
      }
    }

    columnDefs.push(`  ${def}`)
  }

  if (
    primaryKeys.length > 0 &&
    !columns.some((column) => column.autoIncrement)
  ) {
    const pkCols = primaryKeys.map((pk) => `\`${pk}\``).join(', ')
    columnDefs.push(`  PRIMARY KEY (${pkCols})`)
  }

  return `CREATE TABLE IF NOT EXISTS \`${tableName}\` (\n${columnDefs.join(
    ',\n'
  )}\n);`
}

function generateSqliteTableRebuild(tableName, model, existingTable) {
  const columns = []

  for (const [attrName, attr] of Object.entries(model.attributes)) {
    const mapped = mapSqliteModelColumn(attr, attrName, model.primaryKey)
    columns.push({
      name: attr.columnName || attrName,
      ...mapped
    })
  }

  const oldTableName = `${tableName}__old`
  const createSql = generateSqliteCreateTable(tableName, columns)
  const existingColumnNames = new Set(
    (existingTable?.columns || []).map((column) => column.name.toLowerCase())
  )
  const copyableColumns = columns
    .map((column) => column.name)
    .filter((columnName) => existingColumnNames.has(columnName.toLowerCase()))
  const quotedColumns = copyableColumns
    .map((columnName) => `\`${columnName}\``)
    .join(', ')
  const copySql =
    copyableColumns.length > 0
      ? `INSERT INTO \`${tableName}\` (${quotedColumns}) SELECT ${quotedColumns} FROM \`${oldTableName}\`;`
      : null
  const indexStatements = generateSqliteIndexStatements(tableName, model).map(
    (statement) => statement.sql
  )

  return [
    'BEGIN;',
    `ALTER TABLE \`${tableName}\` RENAME TO \`${oldTableName}\`;`,
    createSql,
    copySql,
    ...indexStatements,
    `DROP TABLE \`${oldTableName}\`;`,
    'COMMIT;'
  ]
    .filter(Boolean)
    .join('\n')
}

function generateSqliteIndexStatements(tableName, model) {
  const statements = []

  for (const [attrName, attr] of Object.entries(model.attributes)) {
    const columnName = attr.columnName || attrName
    const needsIndex = attr.unique || attr.index
    const isPrimaryKey = attr.primaryKey || attrName === model.primaryKey

    if (!needsIndex || isPrimaryKey) {
      continue
    }

    statements.push({
      type: 'create_index',
      table: tableName,
      column: columnName,
      sql: generateSqliteIndexSql(tableName, columnName, attr.unique)
    })
  }

  return statements
}

function generateSqliteIndexSql(tableName, columnName, isUnique) {
  const uniqueKeyword = isUnique ? 'UNIQUE ' : ''
  return `CREATE ${uniqueKeyword}INDEX IF NOT EXISTS \`idx_${tableName}_${columnName}\` ON \`${tableName}\` (\`${columnName}\`);`
}

function findModelByTableName(models, tableName) {
  return Object.values(models).find(
    (model) => (model.tableName || model.identity) === tableName
  )
}

function mapSqliteModelColumn(attr, attrName, modelPrimaryKey) {
  const isPrimaryKey = attr.primaryKey || attrName === modelPrimaryKey
  const isAutoIncrement = attr.autoIncrement || false
  const isTimestamp = attr.autoCreatedAt || attr.autoUpdatedAt
  const isForeignKey = attr.foreignKey || false

  return {
    sqlType: mapSqliteType(
      attr,
      isPrimaryKey,
      isAutoIncrement,
      isTimestamp,
      isForeignKey
    ),
    nullable: !attr.required && attr.allowNull !== false,
    defaultValue: attr.defaultsTo,
    autoIncrement: isAutoIncrement,
    unique: attr.unique || false,
    primaryKey: isPrimaryKey
  }
}

function mapSqliteType(
  attr,
  isPrimaryKey,
  isAutoIncrement,
  isTimestamp,
  isForeignKey
) {
  if (attr.columnType) {
    return normalizeSqliteType(attr.columnType)
  }

  if (isAutoIncrement || isTimestamp) {
    return 'INTEGER'
  }

  switch (attr.type) {
    case 'string':
    case 'text':
      return 'TEXT'
    case 'number':
      return isPrimaryKey || isForeignKey ? 'INTEGER' : 'INTEGER'
    case 'boolean':
      return 'INTEGER'
    case 'json':
    case 'ref':
      return 'TEXT'
    default:
      return 'TEXT'
  }
}

function normalizeSqliteType(type) {
  const normalized = String(type)
    .toLowerCase()
    .trim()
    .replace(/\(\d+(?:,\s*\d+)?\)/, '')

  switch (normalized) {
    case '_string':
    case '_text':
    case '_mediumtext':
    case '_longtext':
      return 'TEXT'
    case '_number':
    case '_numberkey':
    case '_numbertimestamp':
    case 'int':
    case 'integer':
      return 'INTEGER'
    case '_json':
      return 'TEXT'
    case 'float':
    case 'double':
    case 'real':
      return 'REAL'
    case 'boolean':
      return 'INTEGER'
    case 'date':
    case 'datetime':
      return 'TEXT'
    case 'binary':
    case 'blob':
      return 'BLOB'
    default:
      return normalized.toUpperCase()
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
    if (dbType === 'mysql' || dbType === 'sqlite') {
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
