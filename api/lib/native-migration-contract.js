const { createHash } = require('node:crypto')
const { typeFingerprint, isPhysicalType } = require('./schema-contract')

function quoteIdentifier(value, dialect) {
  const quote = dialect === 'postgresql' ? '"' : '`'
  if (typeof value !== 'string' || !value || value.includes('\0'))
    throw new Error('Invalid database identifier.')
  return quote + value.replaceAll(quote, quote + quote) + quote
}

function safeType(value) {
  if (!isPhysicalType(value) || value.startsWith('_'))
    throw new Error(
      'Custom SQL definitions require a reviewed native migration.'
    )
  return value
}

function isWidening(from, to, dialect) {
  const a = typeFingerprint(from, dialect),
    b = typeFingerprint(to, dialect)
  if (a === b) return true
  if (a.endsWith(' unsigned') !== b.endsWith(' unsigned')) return false
  const integers = ['smallint', 'integer', 'bigint']
  if (integers.includes(a) && integers.includes(b))
    return integers.indexOf(b) > integers.indexOf(a)
  if (a === 'real' && b === 'double precision' && dialect === 'postgresql')
    return true
  const av = a.match(/^varchar\((\d+)\)$/),
    bv = b.match(/^varchar\((\d+)\)$/)
  if (av && bv) return Number(bv[1]) >= Number(av[1])
  if (av && b === 'varchar' && dialect === 'postgresql') return true
  const an = a.match(/^(?:numeric|decimal)\((\d+),(\d+)\)$/),
    bn = b.match(/^(?:numeric|decimal)\((\d+),(\d+)\)$/)
  return Boolean(
    an &&
      bn &&
      Number(bn[2]) >= Number(an[2]) &&
      Number(bn[1]) - Number(bn[2]) >= Number(an[1]) - Number(an[2])
  )
}

// SHOW CREATE TABLE is the source of truth for MySQL attributes. Split only
// top-level definitions, respecting nested expressions and quoted comments.
function tableDefinitions(sql) {
  const result = []
  let quote = null,
    depth = 0,
    start = -1
  for (let i = String(sql || '').indexOf('('); i >= 0 && i < sql.length; i++) {
    const c = sql[i]
    if (quote) {
      if (c === '\\') i++
      else if (c === quote) {
        if (sql[i + 1] === quote) i++
        else quote = null
      }
      continue
    }
    if (["'", '"', '`'].includes(c)) {
      quote = c
      continue
    }
    if (c === '(') {
      depth++
      if (depth === 1) start = i + 1
    }
    if ((c === ',' && depth === 1) || (c === ')' && depth === 1)) {
      result.push(sql.slice(start, i).trim())
      start = i + 1
      if (c === ')') return result
    }
    if (c === ')') depth--
  }
  throw new Error('The native table definition could not be verified.')
}

function mysqlModifiedDefinition(table, change) {
  const identifier = quoteIdentifier(change.columnName, 'mysql')
  const definition = tableDefinitions(table?.sql).find((item) =>
    item.startsWith(identifier + ' ')
  )
  if (!definition)
    throw new Error(
      'Refresh the complete native column definition before migrating.'
    )
  const rest = definition.slice(identifier.length).trimStart()
  const type = rest.match(
    /^[a-zA-Z]+(?:\(\d+(?:,\s*\d+)?\))?(?: unsigned)?(?: zerofill)?/i
  )?.[0]
  if (
    !type ||
    typeFingerprint(type, 'mysql') !==
      typeFingerprint(change.current.type, 'mysql')
  )
    throw new Error('This native column type requires a reviewed migration.')
  if (change.current.nullable !== change.expected.nullable)
    throw new Error(
      'Changing nullability needs an explicit data validation and backfill plan.'
    )
  return `${identifier} ${safeType(change.expected.sqlType)}${rest.slice(
    type.length
  )}`
}

function nativeStatements(diff, dialect, schema = {}, models = {}) {
  const statements = [],
    q = (value) => quoteIdentifier(value, dialect)
  const emit = (type, table, sql, extra = {}) =>
    statements.push({ type, table, sql, risk: 'schema-lock', ...extra })
  const indexName = (table, column) =>
    'sw_' +
    createHash('sha256')
      .update(JSON.stringify([table, column, false]))
      .digest('hex')
      .slice(0, 24)
  try {
    if (diff.tablesToDrop?.length || diff.columnsToDrop?.length)
      throw new Error('Dropping data requires a verified recovery plan.')
    for (const change of diff.columnsToRename || [])
      emit(
        'rename_column',
        change.tableName,
        `ALTER TABLE ${q(change.tableName)} RENAME COLUMN ${q(
          change.fromColumnName
        )} TO ${q(change.toColumnName)};`,
        { column: change.toColumnName, fromColumn: change.fromColumnName }
      )
    for (const table of diff.tablesToCreate) {
      const definitions = table.columns.map((column) => {
        let type = safeType(column.sqlType)
        if (
          dialect === 'postgresql' &&
          column.autoIncrement &&
          !/^(smallserial|serial|bigserial)$/i.test(type)
        )
          throw new Error(
            'Choose an adapter-compatible serial type for this identity column.'
          )
        return `${q(column.name)} ${type}${
          dialect === 'mysql' && column.autoIncrement ? ' AUTO_INCREMENT' : ''
        }${column.nullable === false ? ' NOT NULL' : ''}${
          column.unique && !column.primaryKey ? ' UNIQUE' : ''
        }`
      })
      const keys = table.columns
        .filter((column) => column.primaryKey)
        .map((column) => q(column.name))
      if (keys.length) definitions.push(`PRIMARY KEY (${keys.join(', ')})`)
      emit(
        'create_table',
        table.tableName,
        `CREATE TABLE ${q(table.tableName)} (\n  ${definitions.join(
          ',\n  '
        )}\n);`,
        { risk: 'new-table' }
      )
      const model = Object.values(models).find(
        (model) => (model.tableName || model.identity) === table.tableName
      )
      for (const [name, attr] of Object.entries(model?.attributes || {}))
        if (attr.index && !attr.unique && name !== model.primaryKey) {
          const column = attr.columnName || name
          emit(
            'create_index',
            table.tableName,
            `CREATE INDEX ${q(indexName(table.tableName, column))} ON ${q(
              table.tableName
            )} (${q(column)});`,
            { column, unique: false }
          )
        }
    }
    for (const column of diff.columnsToAdd) {
      if (
        column.nullable === false ||
        column.autoIncrement ||
        column.primaryKey
      )
        throw new Error(
          'Adding a constrained column needs a verified backfill and key plan.'
        )
      emit(
        'add_column',
        column.tableName,
        `ALTER TABLE ${q(column.tableName)} ADD COLUMN ${q(
          column.columnName
        )} ${safeType(column.sqlType)};`,
        { column: column.columnName }
      )
    }
    for (const change of diff.columnsToModify) {
      if (change.current.generated)
        throw new Error(
          'Generated columns require a reviewed native migration.'
        )
      if (!isWidening(change.current.type, change.expected.sqlType, dialect))
        throw new Error(
          `The ${change.tableName}.${change.columnName} cast may lose data. Provide a reviewed USING/default conversion or backfill migration.`
        )
      if (dialect === 'mysql')
        emit(
          'modify_column',
          change.tableName,
          `ALTER TABLE ${q(
            change.tableName
          )} MODIFY COLUMN ${mysqlModifiedDefinition(
            schema[change.tableName],
            change
          )};`,
          { column: change.columnName, risk: 'possible-table-rewrite' }
        )
      else {
        if (change.current.nullable !== change.expected.nullable)
          throw new Error(
            'Changing nullability needs an explicit data validation and backfill plan.'
          )
        emit(
          'modify_column',
          change.tableName,
          `ALTER TABLE ${q(change.tableName)} ALTER COLUMN ${q(
            change.columnName
          )} TYPE ${safeType(change.expected.sqlType)};`,
          { column: change.columnName, risk: 'possible-table-rewrite' }
        )
      }
    }
    for (const index of diff.indexesToCreate)
      emit(
        'create_index',
        index.tableName,
        `CREATE ${index.unique ? 'UNIQUE ' : ''}INDEX ${q(
          index.indexName || indexName(index.tableName, index.columnName)
        )} ON ${q(index.tableName)} (${q(index.columnName)});`,
        {
          column: index.columnName,
          unique: Boolean(index.unique),
          risk: index.unique
            ? 'unique-validation-and-lock'
            : 'index-build-and-lock'
        }
      )
    return statements
  } catch (error) {
    return [
      {
        type: 'blocked_native_migration',
        blocked: true,
        reason: error.message,
        sql: '-- Automatic migration blocked: ' + error.message
      }
    ]
  }
}

module.exports = {
  quoteIdentifier,
  isWidening,
  mysqlModifiedDefinition,
  nativeStatements
}
