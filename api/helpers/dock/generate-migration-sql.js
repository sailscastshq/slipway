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

    // Generate RENAME COLUMN statements
    for (const col of diff.columnsToRename || []) {
      const sql = generateRenameColumn(col, dbType, quote)
      statements.push({
        type: 'rename_column',
        table: col.tableName,
        column: col.toColumnName,
        fromColumn: col.fromColumnName,
        sql
      })
    }

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
    statements.push(
      generateSqliteTableRebuildStatement({
        tableName,
        existingTable,
        modifications: diff.columnsToModify.filter(
          (column) => column.tableName === tableName
        ),
        renames: (diff.columnsToRename || []).filter(
          (column) => column.tableName === tableName
        ),
        additions: (diff.columnsToAdd || []).filter(
          (column) => column.tableName === tableName
        ),
        drops: (diff.columnsToDrop || []).filter(
          (column) => column.tableName === tableName
        )
      })
    )
  }

  for (const column of diff.columnsToRename || []) {
    if (rebuiltTables.has(column.tableName)) {
      continue
    }

    statements.push({
      type: 'rename_column',
      table: column.tableName,
      column: column.toColumnName,
      fromColumn: column.fromColumnName,
      sql: generateRenameColumn(column, 'sqlite', '`')
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

function generateRenameColumn(col, dbType, quote) {
  return `ALTER TABLE ${quote}${col.tableName}${quote} RENAME COLUMN ${quote}${col.fromColumnName}${quote} TO ${quote}${col.toColumnName}${quote};`
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

function generateSqliteTableRebuildStatement({
  tableName,
  existingTable,
  modifications,
  renames,
  additions,
  drops
}) {
  const unsupportedChanges = [
    renames.length > 0 && 'column renames',
    additions.length > 0 && 'column additions',
    drops.length > 0 && 'column removals'
  ].filter(Boolean)

  if (unsupportedChanges.length > 0) {
    return blockedSqliteRebuild(
      tableName,
      `A table rebuild combined with ${unsupportedChanges.join(
        ', '
      )} cannot be represented without guessing.`
    )
  }

  if (!existingTable.sql) {
    return blockedSqliteRebuild(
      tableName,
      'SQLite did not return the original CREATE TABLE definition.'
    )
  }

  try {
    const temporaryTableName = `${tableName}__slipway_new`
    const createSql = rewriteSqliteCreateTable({
      sql: existingTable.sql,
      tableName,
      temporaryTableName,
      modifications
    })
    const columns = (existingTable.columns || []).map((column) => column.name)

    if (columns.length === 0) {
      throw new Error('The existing table has no copyable columns.')
    }

    const recreateSql = []
    const dropDependentViewsSql = []
    const preservedObjects = []

    for (const index of existingTable.indexes || []) {
      if (index.origin === 'u' && !index.sql) {
        preservedObjects.push({ type: 'unique constraint', name: index.name })
        continue
      }

      if (!index.sql) {
        throw new Error(
          `Index ${index.name} does not have a replayable SQLite definition.`
        )
      }

      recreateSql.push(terminateSql(index.sql))
      preservedObjects.push({ type: 'index', name: index.name })
    }

    for (const trigger of existingTable.triggers || []) {
      if (!trigger.sql) {
        throw new Error(
          `Trigger ${trigger.name} does not have a replayable SQLite definition.`
        )
      }

      recreateSql.push(terminateSql(trigger.sql))
      preservedObjects.push({ type: 'trigger', name: trigger.name })
    }

    for (const view of existingTable.views || []) {
      if (!view.sql) {
        throw new Error(
          `View ${view.name} does not have a replayable SQLite definition.`
        )
      }

      dropDependentViewsSql.push(
        `DROP VIEW ${quoteSqliteIdentifier(view.name)};`
      )
      recreateSql.push(terminateSql(view.sql))
      preservedObjects.push({ type: 'view', name: view.name })
    }

    const quotedColumns = columns.map(quoteSqliteIdentifier).join(', ')
    const sql = [
      terminateSql(createSql),
      `INSERT INTO ${quoteSqliteIdentifier(
        temporaryTableName
      )} (${quotedColumns}) SELECT ${quotedColumns} FROM ${quoteSqliteIdentifier(
        tableName
      )};`,
      ...dropDependentViewsSql,
      `DROP TABLE ${quoteSqliteIdentifier(tableName)};`,
      `ALTER TABLE ${quoteSqliteIdentifier(
        temporaryTableName
      )} RENAME TO ${quoteSqliteIdentifier(tableName)};`,
      ...recreateSql
    ].join('\n')

    return {
      type: 'rebuild_table',
      table: tableName,
      risk: 'high',
      sql,
      currentSchemaSql: existingTable.sql,
      changedColumns: modifications.map((modification) => ({
        column: modification.columnName,
        current: {
          type: modification.current.type,
          defaultValue: modification.current.defaultValue,
          nullable: modification.current.nullable
        },
        expected: {
          type: modification.expected.sqlType,
          defaultValue: modification.expected.defaultValue,
          nullable: modification.expected.nullable
        }
      })),
      preservedObjects,
      verification: {
        rowCount: true,
        integrityCheck: true,
        foreignKeyCheck: true
      }
    }
  } catch (error) {
    return blockedSqliteRebuild(tableName, error.message)
  }
}

function blockedSqliteRebuild(tableName, reason) {
  return {
    type: 'blocked_rebuild',
    table: tableName,
    blocked: true,
    risk: 'blocked',
    reason,
    sql: `-- Bosun blocked this rebuild: ${reason}`
  }
}

function rewriteSqliteCreateTable({
  sql,
  tableName,
  temporaryTableName,
  modifications
}) {
  const openParen = findFirstSqliteStructuralCharacter(sql, '(')
  const closeParen = findMatchingSqliteParenthesis(sql, openParen)

  if (openParen === -1 || closeParen === -1) {
    throw new Error('The CREATE TABLE definition could not be parsed safely.')
  }

  const prefix = sql.slice(0, openParen)
  const rewrittenPrefix = prefix.replace(
    /^(\s*CREATE\s+TABLE\s+)(?:IF\s+NOT\s+EXISTS\s+)?(?:"(?:[^"]|"")*"|`(?:[^`]|``)*`|\[[^\]]*\]|[^\s(]+)(\s*)$/i,
    `$1${quoteSqliteIdentifier(temporaryTableName)}$2`
  )

  if (rewrittenPrefix === prefix) {
    throw new Error(`The CREATE TABLE prefix for ${tableName} is unsupported.`)
  }

  const definitions = splitSqliteDefinitions(
    sql.slice(openParen + 1, closeParen)
  )
  const modificationMap = new Map(
    modifications.map((modification) => [
      modification.columnName.toLowerCase(),
      modification
    ])
  )
  const rewrittenColumns = new Set()
  const rewrittenDefinitions = definitions.map((definition) => {
    const parsed = parseSqliteColumnDefinition(definition)
    if (!parsed || !modificationMap.has(parsed.name.toLowerCase())) {
      return definition
    }

    const modification = modificationMap.get(parsed.name.toLowerCase())
    rewrittenColumns.add(parsed.name.toLowerCase())
    return replaceSqliteDeclaredType(
      definition,
      parsed.identifierEnd,
      modification.expected.sqlType
    )
  })

  if (rewrittenColumns.size !== modificationMap.size) {
    const missingColumns = Array.from(modificationMap.keys()).filter(
      (column) => !rewrittenColumns.has(column)
    )
    throw new Error(
      `Could not safely locate column definition(s): ${missingColumns.join(
        ', '
      )}.`
    )
  }

  return `${rewrittenPrefix}(${rewrittenDefinitions.join(',')})${sql.slice(
    closeParen + 1
  )}`
}

function splitSqliteDefinitions(body) {
  const definitions = []
  let start = 0
  let depth = 0
  let quote = null

  for (let index = 0; index < body.length; index++) {
    const character = body[index]
    const next = body[index + 1]

    if (quote) {
      if (character === quote) {
        if (next === quote && quote !== ']') {
          index++
        } else {
          quote = null
        }
      }
      continue
    }

    if (character === "'" || character === '"' || character === '`') {
      quote = character
    } else if (character === '[') {
      quote = ']'
    } else if (character === '(') {
      depth++
    } else if (character === ')') {
      depth--
    } else if (character === ',' && depth === 0) {
      definitions.push(body.slice(start, index))
      start = index + 1
    }
  }

  if (quote || depth !== 0) {
    throw new Error('The CREATE TABLE column list is not balanced.')
  }

  definitions.push(body.slice(start))
  return definitions
}

function parseSqliteColumnDefinition(definition) {
  const leadingWhitespace = definition.match(/^\s*/)[0].length
  const firstWord = definition
    .slice(leadingWhitespace)
    .match(/^(CONSTRAINT|PRIMARY|UNIQUE|CHECK|FOREIGN)\b/i)

  if (firstWord) return null

  const identifier = readSqliteIdentifier(definition, leadingWhitespace)
  if (!identifier) return null

  return identifier
}

function readSqliteIdentifier(sql, start) {
  const first = sql[start]

  if (first === '"' || first === '`' || first === '[') {
    const closing = first === '[' ? ']' : first
    let value = ''

    for (let index = start + 1; index < sql.length; index++) {
      if (sql[index] === closing) {
        if (sql[index + 1] === closing && closing !== ']') {
          value += closing
          index++
          continue
        }

        return { name: value, identifierEnd: index + 1 }
      }
      value += sql[index]
    }

    return null
  }

  const match = sql.slice(start).match(/^[^\s,()]+/)
  if (!match) return null
  return { name: match[0], identifierEnd: start + match[0].length }
}

function replaceSqliteDeclaredType(definition, identifierEnd, expectedType) {
  if (
    !/^[A-Za-z][A-Za-z0-9_ ]*(?:\(\s*\d+(?:\s*,\s*\d+)?\s*\))?$/.test(
      expectedType
    )
  ) {
    throw new Error(`Unsafe SQLite type: ${expectedType}.`)
  }

  let typeStart = identifierEnd
  while (/\s/.test(definition[typeStart] || '')) typeStart++

  if (
    /^(PRIMARY|NOT|UNIQUE|CHECK|DEFAULT|COLLATE|REFERENCES|GENERATED|AS)\b/i.test(
      definition.slice(typeStart)
    )
  ) {
    throw new Error(
      'A column without a declared type cannot be rewritten safely.'
    )
  }

  let typeEnd = definition.length
  let depth = 0
  let quote = null

  for (let index = typeStart; index < definition.length; index++) {
    const character = definition[index]
    const next = definition[index + 1]

    if (quote) {
      if (character === quote) {
        if (next === quote && quote !== ']') index++
        else quote = null
      }
      continue
    }

    if (character === "'" || character === '"' || character === '`') {
      quote = character
    } else if (character === '[') {
      quote = ']'
    } else if (character === '(') {
      depth++
    } else if (character === ')') {
      depth--
    } else if (depth === 0 && /\s/.test(character)) {
      const remainder = definition.slice(index).trimStart()
      if (
        /^(PRIMARY|NOT|UNIQUE|CHECK|DEFAULT|COLLATE|REFERENCES|GENERATED|AS)\b/i.test(
          remainder
        )
      ) {
        typeEnd = index
        break
      }
    }
  }

  if (!definition.slice(typeStart, typeEnd).trim()) {
    throw new Error(
      'A column without a declared type cannot be rewritten safely.'
    )
  }

  return `${definition.slice(0, typeStart)}${expectedType}${definition.slice(
    typeEnd
  )}`
}

function findFirstSqliteStructuralCharacter(sql, target) {
  let quote = null

  for (let index = 0; index < sql.length; index++) {
    const character = sql[index]
    const next = sql[index + 1]

    if (quote) {
      if (character === quote) {
        if (next === quote && quote !== ']') index++
        else quote = null
      }
      continue
    }

    if (character === '"' || character === '`' || character === "'") {
      quote = character
    } else if (character === '[') {
      quote = ']'
    } else if (character === target) {
      return index
    }
  }

  return -1
}

function findMatchingSqliteParenthesis(sql, openParen) {
  let depth = 0
  let quote = null

  for (let index = openParen; index < sql.length; index++) {
    const character = sql[index]
    const next = sql[index + 1]

    if (quote) {
      if (character === quote) {
        if (next === quote && quote !== ']') index++
        else quote = null
      }
      continue
    }

    if (character === '"' || character === '`' || character === "'") {
      quote = character
    } else if (character === '[') {
      quote = ']'
    } else if (character === '(') {
      depth++
    } else if (character === ')') {
      depth--
      if (depth === 0) return index
    }
  }

  return -1
}

function quoteSqliteIdentifier(value) {
  return `\`${String(value).replace(/`/g, '``')}\``
}

function terminateSql(sql) {
  return `${String(sql).trim().replace(/;+$/, '')};`
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
    case '_boolean':
      return 'INTEGER'
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
