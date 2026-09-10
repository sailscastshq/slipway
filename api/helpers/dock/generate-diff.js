const crypto = require('node:crypto')
const {
  typeFingerprint,
  indexFingerprint,
  satisfiesIndex,
  isPhysicalType
} = require('../../lib/schema-contract')

/**
 * Generate schema diff between Waterline models and database schema.
 *
 * Type mappings are based on actual sails-postgresql and sails-mysql adapter source code:
 * - PostgreSQL: sails-postgresql/helpers/private/schema/build-schema.js
 * - MySQL: sails-mysql/helpers/private/schema/build-schema.js
 */

module.exports = {
  friendlyName: 'Generate schema diff',

  description: 'Compare Waterline models against current database schema.',

  inputs: {
    models: {
      type: 'ref',
      required: true,
      description: 'Waterline models from get-models'
    },
    schema: {
      type: 'ref',
      required: true,
      description: 'Database schema from get-schema'
    },
    dbType: {
      type: 'string',
      required: true,
      isIn: ['postgresql', 'mysql', 'mongodb', 'sqlite'],
      description: 'Database type'
    }
  },

  exits: {
    success: {
      description: 'Diff generated successfully',
      outputType: 'ref'
    }
  },

  fn: async function ({ models, schema, dbType }) {
    const diff = {
      tablesToCreate: [],
      tablesToDrop: [],
      columnsToRename: [],
      columnsToAdd: [],
      columnsToModify: [],
      columnsToDrop: [],
      indexesToCreate: [],
      unsupported: [],
      preserved: [],
      state: 'up_to_date'
    }

    const existingTables = new Set(Object.keys(schema))
    const modelTables = new Set()

    // MongoDB: only check for missing collections (schemaless DB)
    if (dbType === 'mongodb') {
      for (const [identity, model] of Object.entries(models)) {
        const collectionName = model.tableName || identity
        modelTables.add(collectionName)

        if (!existingTables.has(collectionName)) {
          // Collection doesn't exist - needs to be created
          diff.tablesToCreate.push({
            tableName: collectionName,
            model: identity,
            columns: [], // MongoDB is schemaless
            primaryKey: '_id'
          })
        }
        // MongoDB doesn't have column-level schema enforcement
        // so we don't check for columns to add/modify
      }
      diff.state = diff.tablesToCreate.length ? 'changes_pending' : 'up_to_date'
      return diff
    }

    // SQL databases: full column-level diff
    // Check each model
    for (const [identity, model] of Object.entries(models)) {
      const tableName = model.tableName || identity
      modelTables.add(tableName)

      const existingTable = schema[tableName]

      if (!existingTable) {
        // Table doesn't exist - needs to be created
        const columns = []
        let primaryKeyColumn = null

        for (const [name, attr] of Object.entries(model.attributes)) {
          const columnName = attr.columnName || name
          const mapped = mapWaterlineToSql(attr, name, dbType, model.primaryKey)

          columns.push({
            name: columnName,
            ...mapped
          })

          if (name === model.primaryKey || attr.primaryKey) {
            primaryKeyColumn = columnName
          }
        }

        diff.tablesToCreate.push({
          tableName,
          model: identity,
          columns,
          primaryKey: primaryKeyColumn
        })
      } else {
        if (!existingTable.catalogComplete)
          diff.unsupported.push({
            tableName,
            reason: 'The database catalog inventory is incomplete.'
          })
        diff.preserved.push({
          tableName,
          kind: 'native definitions',
          columns: existingTable.columns,
          indexes: (existingTable.indexes || []).map((index) => ({
            ...index,
            fingerprint: indexFingerprint(index)
          })),
          constraints: existingTable.constraints || [],
          triggers: existingTable.triggers || [],
          views: existingTable.views || [],
          sql: existingTable.sql || null
        })
        // Table exists - check columns
        const existingColumns = new Map(
          existingTable.columns.map((col) => [col.name, col])
        )

        for (const [attrName, attr] of Object.entries(model.attributes)) {
          const columnName = attr.columnName || attrName
          const existingCol = existingColumns.get(columnName)

          if (!existingCol) {
            const renameFrom = findRenameSourceColumn(
              existingColumns,
              attrName,
              columnName
            )

            if (renameFrom) {
              const expected = mapWaterlineToSql(
                attr,
                attrName,
                dbType,
                model.primaryKey
              )
              if (needsModification(renameFrom, expected, dbType))
                diff.unsupported.push({
                  tableName,
                  columnName,
                  reason:
                    'Renaming and changing a column definition together requires a reviewed native migration.',
                  current: renameFrom,
                  expected
                })
              diff.columnsToRename.push({
                tableName,
                fromColumnName: renameFrom.name,
                toColumnName: columnName
              })
            } else {
              // Column doesn't exist - needs to be added
              diff.columnsToAdd.push({
                tableName,
                columnName,
                ...mapWaterlineToSql(attr, attrName, dbType, model.primaryKey)
              })
            }
          } else {
            // Column exists - check for type differences
            const expected = mapWaterlineToSql(
              attr,
              attrName,
              dbType,
              model.primaryKey
            )
            // Preserve native defaults/nullability unless the physical contract
            // explicitly manages them; application validation is not DDL.
            if (attr.physical?.notNull === undefined)
              expected.nullable = existingCol.nullable
            const identityChanged =
              existingCol.autoIncrement !== undefined &&
              Boolean(existingCol.autoIncrement) !== expected.autoIncrement
            const keyChanged =
              existingCol.primaryKey !== undefined &&
              Boolean(existingCol.primaryKey) !==
                (dbType === 'sqlite'
                  ? expected.autoIncrement
                  : expected.primaryKey)
            if (identityChanged || keyChanged)
              diff.unsupported.push({
                tableName,
                columnName,
                reason:
                  'Changing primary keys or identity generation requires a reviewed native migration.',
                current: existingCol,
                expected
              })
            if (
              needsModification(existingCol, expected, dbType) ||
              (attr.physical?.notNull !== undefined &&
                existingCol.nullable !== expected.nullable)
            ) {
              if (existingCol.generated)
                diff.unsupported.push({
                  tableName,
                  columnName,
                  reason:
                    'This column has native properties that need a preserving migration.',
                  current: existingCol,
                  expected
                })
              diff.columnsToModify.push({
                tableName,
                columnName,
                current: existingCol,
                expected
              })
            }
          }
        }
      }
    }

    // Index comparison: check for missing indexes on existing tables
    for (const [identity, model] of Object.entries(models)) {
      const tableName = model.tableName || identity
      const existingTable = schema[tableName]
      if (!existingTable) continue // New tables handled above

      const existingIndexes = existingTable.indexes || []
      const renamedColumns = new Map(
        diff.columnsToRename
          .filter((column) => column.tableName === tableName)
          .map((column) => [column.toColumnName, column.fromColumnName])
      )
      for (const [attrName, attr] of Object.entries(model.attributes)) {
        const columnName = attr.columnName || attrName
        const needsIndex = attr.unique || attr.index

        if (
          needsIndex &&
          !existingIndexes.some((index) =>
            satisfiesIndex(
              index,
              renamedColumns.get(columnName) || columnName,
              Boolean(attr.unique)
            )
          )
        ) {
          // Check it's not the primary key (PKs already have indexes)
          const isPK =
            dbType === 'sqlite'
              ? attr.autoIncrement
              : attrName === model.primaryKey || attr.primaryKey
          if (!isPK) {
            diff.indexesToCreate.push({
              tableName,
              columnName,
              unique: attr.unique || false,
              indexName: availableIndexName(
                tableName,
                columnName,
                Boolean(attr.unique),
                existingIndexes
              )
            })
          }
        }
      }
    }

    for (const addition of diff.columnsToAdd) {
      if (addition.nullable === false)
        diff.unsupported.push({
          tableName: addition.tableName,
          columnName: addition.columnName,
          reason:
            'A non-null column needs a verified backfill before it can be added.'
        })
    }
    for (const change of diff.columnsToModify) {
      if (
        dbType === 'sqlite' &&
        change.current.nullable !== change.expected.nullable
      )
        diff.unsupported.push({
          tableName: change.tableName,
          columnName: change.columnName,
          reason:
            'Changing native nullability requires a verified backfill and constraint migration.'
        })
      const table = schema[change.tableName]
      if (
        dbType !== 'sqlite' &&
        ((table.views || []).length || (table.triggers || []).length)
      )
        diff.unsupported.push({
          tableName: change.tableName,
          columnName: change.columnName,
          reason:
            'Native views or triggers require a dependency-aware migration.',
          current: change.current,
          expected: change.expected
        })
    }
    for (const [tableName, table] of Object.entries(schema)) {
      if (!modelTables.has(tableName)) {
        diff.preserved.push({
          tableName,
          kind: 'unmanaged table',
          sql: table.sql || null
        })
        if (!table.catalogComplete)
          diff.unsupported.push({
            tableName,
            reason: 'An unmanaged table could not be inventoried.'
          })
      }
    }
    for (const model of Object.values(models)) {
      for (const [name, attr] of Object.entries(model.attributes)) {
        if (
          dbType === 'sqlite' &&
          [model.tableName, attr.columnName || name].some((value) =>
            /[`\0]/.test(value)
          )
        )
          diff.unsupported.push({
            tableName: model.tableName,
            columnName: attr.columnName || name,
            reason:
              'This SQLite identifier requires a reviewed native migration.'
          })
        if (attr.columnType && !isPhysicalType(attr.columnType)) {
          diff.unsupported.push({
            tableName: model.tableName,
            columnName: attr.columnName || name,
            reason:
              'This custom column definition requires a reviewed native migration.'
          })
        }
      }
    }
    diff.state = diff.unsupported.length
      ? 'unverified'
      : Object.entries(diff).some(
          ([key, value]) =>
            /To(Create|Add|Modify|Rename|Drop)$/.test(key) && value.length
        )
      ? 'changes_pending'
      : 'up_to_date'
    return diff
  }
}

function findRenameSourceColumn(existingColumns, attrName, columnName) {
  if (attrName === columnName) {
    return null
  }

  return existingColumns.get(attrName) || null
}

/**
 * Map Waterline attribute to SQL type based on actual adapter behavior.
 *
 * Waterline internally uses logical types like _string, _number, _numberkey etc.
 * The adapters then map these to actual SQL types.
 *
 * PostgreSQL mappings (from sails-postgresql):
 *   _number      -> REAL (or SERIAL with autoIncrement)
 *   _numberkey   -> INTEGER (or SERIAL with autoIncrement)
 *   _numbertimestamp -> BIGINT
 *   _string      -> TEXT
 *   _stringkey   -> VARCHAR
 *   _boolean     -> BOOLEAN
 *   _json        -> JSON
 *   _ref         -> TEXT
 *
 * MySQL mappings (from sails-mysql):
 *   _number      -> REAL
 *   _numberkey   -> INTEGER (with AUTO_INCREMENT)
 *   _numbertimestamp -> BIGINT
 *   _string      -> VARCHAR(255)
 *   _stringkey   -> VARCHAR(255)
 *   _boolean     -> BOOLEAN (-> TINYINT(1))
 *   _json        -> LONGTEXT
 *   _ref         -> LONGTEXT
 *
 * SQLite booleans use INTEGER as Bosun's canonical representation. Existing
 * INTEGER, BOOLEAN, and sails-sqlite legacy TEXT columns compare as the same
 * logical boolean contract, so healthy schemas do not churn.
 */
function mapWaterlineToSql(attr, attrName, dbType, modelPrimaryKey) {
  const logicalColumnType = attr.columnType?.startsWith('_')
    ? attr.columnType
    : undefined
  // Resolve ORM logical column types exactly as sails-postgresql does.
  // Unknown/custom SQL still passes through the native migration validator.
  if (dbType === 'postgresql' && attr.columnType) {
    const logicalTypes = {
      _number: attr.autoIncrement ? 'SERIAL' : 'REAL',
      _numberkey: attr.autoIncrement ? 'SERIAL' : 'INTEGER',
      _numbertimestamp: attr.autoIncrement ? 'BIGSERIAL' : 'BIGINT',
      _string: 'TEXT',
      _stringkey: 'VARCHAR',
      _stringtimestamp: 'VARCHAR',
      _boolean: 'BOOLEAN',
      _json: 'JSON',
      _ref: 'TEXT'
    }
    const physicalType = logicalTypes[attr.columnType.toLowerCase()]
    if (physicalType) attr = { ...attr, columnType: physicalType }
  }
  // Resolve the same ORM aliases as sails-mysql before validating native SQL.
  if (dbType === 'mysql' && attr.columnType) {
    const logicalTypes = {
      _number: 'REAL',
      _numberkey: 'INTEGER',
      _numbertimestamp: 'BIGINT',
      _string: 'VARCHAR(255)',
      _stringkey: 'VARCHAR(255)',
      _stringtimestamp: 'VARCHAR(255)',
      _boolean: 'BOOLEAN',
      _json: 'LONGTEXT',
      _ref: 'LONGTEXT'
    }
    const physicalType = logicalTypes[attr.columnType.toLowerCase()]
    if (physicalType) attr = { ...attr, columnType: physicalType }
  }
  // If explicit columnType is set, use it directly (adapters do this too)
  if (attr.columnType) {
    return {
      sqlType:
        dbType === 'sqlite'
          ? normalizeSqlitePhysicalType(attr.columnType)
          : attr.columnType,
      logicalType: attr.type,
      logicalColumnType,
      nullable: attr.physical?.notNull !== true,
      defaultValue: undefined,
      autoIncrement: attr.autoIncrement || false,
      unique: attr.unique || false,
      primaryKey:
        dbType === 'sqlite'
          ? Boolean(attr.autoIncrement)
          : Boolean(attr.primaryKey || attrName === modelPrimaryKey)
    }
  }

  const isPrimaryKey = attr.primaryKey || attrName === modelPrimaryKey
  const isAutoIncrement = attr.autoIncrement || false
  const isTimestamp = attr.autoCreatedAt || attr.autoUpdatedAt
  const isForeignKey = attr.foreignKey || false

  // Determine SQL type based on Waterline type and context
  let sqlType

  if (dbType === 'postgresql') {
    sqlType = ['_stringkey', '_stringtimestamp'].includes(attr.columnType)
      ? 'VARCHAR'
      : getPostgresType(
          attr.type,
          isPrimaryKey,
          isAutoIncrement,
          isTimestamp,
          isForeignKey
        )
  } else if (dbType === 'sqlite') {
    sqlType = getSqliteType(
      attr,
      isPrimaryKey,
      isAutoIncrement,
      isTimestamp,
      isForeignKey
    )
  } else {
    sqlType = getMysqlType(
      attr.type,
      isPrimaryKey,
      isAutoIncrement,
      isTimestamp,
      isForeignKey
    )
  }

  return {
    sqlType,
    logicalType: attr.type,
    nullable: attr.physical?.notNull !== true,
    defaultValue: undefined,
    autoIncrement: isAutoIncrement,
    unique: attr.unique || false,
    primaryKey: dbType === 'sqlite' ? isAutoIncrement : isPrimaryKey
  }
}

/**
 * Get SQLite type for a Waterline attribute.
 * Mirrors the physical types produced by sails-sqlite.
 */
function getSqliteType(
  attr,
  isPrimaryKey,
  isAutoIncrement,
  isTimestamp,
  isForeignKey
) {
  const explicitType = attr.columnType
  if (explicitType) {
    return normalizeSqlitePhysicalType(explicitType)
  }

  if (isAutoIncrement) {
    return 'INTEGER'
  }

  if (isTimestamp) {
    return 'INTEGER'
  }

  switch (attr.type) {
    case 'string':
    case 'text':
      return 'TEXT'

    case 'number':
      if (isPrimaryKey || isForeignKey) {
        return 'INTEGER'
      }
      return 'INTEGER'

    case 'boolean':
      return 'INTEGER'

    case 'json':
    case 'ref':
      return 'TEXT'

    default:
      return 'TEXT'
  }
}

/**
 * Get PostgreSQL type for a Waterline type
 */
function getPostgresType(
  waterlineType,
  isPrimaryKey,
  isAutoIncrement,
  isTimestamp,
  isForeignKey
) {
  // Auto-increment primary keys use SERIAL
  if (isAutoIncrement) {
    return 'SERIAL'
  }

  // Timestamps typically use BIGINT (for epoch ms) or timestamptz
  if (isTimestamp) {
    return waterlineType === 'string' ? 'VARCHAR' : 'BIGINT'
  }

  // Map Waterline types to PostgreSQL types
  // Based on sails-postgresql build-schema.js
  switch (waterlineType) {
    case 'string':
      // _string maps to TEXT in PostgreSQL (not VARCHAR!)
      return 'TEXT'

    case 'text':
      return 'TEXT'

    case 'number':
      // _number maps to REAL (floating point)
      // _numberkey (for PKs/FKs) maps to INTEGER
      return isPrimaryKey || isForeignKey ? 'INTEGER' : 'REAL'

    case 'boolean':
      return 'BOOLEAN'

    case 'json':
      // _json maps to JSON in PostgreSQL
      return 'JSON'

    case 'ref':
      // _ref maps to TEXT (for arbitrary references)
      return 'TEXT'

    default:
      return 'TEXT'
  }
}

/**
 * Get MySQL type for a Waterline type
 */
function getMysqlType(
  waterlineType,
  isPrimaryKey,
  isAutoIncrement,
  isTimestamp,
  isForeignKey
) {
  // Timestamps typically use BIGINT
  if (isTimestamp) {
    return waterlineType === 'string' ? 'VARCHAR(255)' : 'BIGINT'
  }

  // Map Waterline types to MySQL types
  // Based on sails-mysql build-schema.js
  switch (waterlineType) {
    case 'string':
      // _string maps to VARCHAR(255) in MySQL
      return 'VARCHAR(255)'

    case 'text':
      return 'TEXT'

    case 'number':
      // _number maps to REAL, _numberkey to INTEGER
      return isPrimaryKey || isForeignKey ? 'INTEGER' : 'REAL'

    case 'boolean':
      // MySQL BOOLEAN is actually TINYINT(1)
      return 'TINYINT(1)'

    case 'json':
      // MySQL uses LONGTEXT for JSON (older versions don't have native JSON)
      return 'LONGTEXT'

    case 'ref':
      // _ref maps to LONGTEXT
      return 'LONGTEXT'

    default:
      return 'TEXT'
  }
}

/**
 * Check if column needs modification
 */
function needsModification(existing, expected, dbType) {
  const current = typeFingerprint(existing.type, dbType)
  // An implicit ORM type does not request narrowing an existing compatible
  // native column. Explicit columnType declarations still compare exactly.
  if (dbType === 'postgresql' && expected.logicalColumnType) {
    const compatible = {
      _string: /^(text|varchar(?:\(\d+\))?|char(?:\(\d+\))?)$/,
      _stringkey: /^(text|varchar(?:\(\d+\))?|char(?:\(\d+\))?)$/,
      _stringtimestamp: /^(text|varchar(?:\(\d+\))?)$/,
      _number:
        /^(smallint|integer|bigint|real|double precision|numeric(?:\(\d+(?:,\d+)?\))?)$/,
      _numberkey: /^(smallint|integer|bigint)$/,
      _numbertimestamp: /^bigint$/,
      _boolean: /^boolean$/,
      _json: /^jsonb?$/,
      _ref: /^text$/
    }
    if (compatible[expected.logicalColumnType]?.test(current)) return false
  }
  if (
    dbType === 'sqlite' &&
    expected.logicalType === 'boolean' &&
    ['boolean', 'bool', 'integer', 'int', 'text'].includes(current)
  )
    return false
  return current !== typeFingerprint(expected.sqlType, dbType)
}

function normalizeType(type) {
  return String(type || '')
    .trim()
    .toLowerCase()
}

function normalizeSqlitePhysicalType(type) {
  const normalized = normalizeType(type)

  switch (normalized) {
    case '_string':
    case '_stringkey':
    case '_stringtimestamp':
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
      return normalized ? normalized.toUpperCase() : 'TEXT'
  }
}

function availableIndexName(table, column, unique, indexes) {
  const base =
    'sw_' +
    crypto
      .createHash('sha256')
      .update(JSON.stringify([table, column, unique]))
      .digest('hex')
      .slice(0, 24)
  let name = base
  for (let n = 1; indexes.some((index) => index.name === name); n++)
    name = `${base}_${n}`
  return name
}
