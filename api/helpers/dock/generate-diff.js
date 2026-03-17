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
      columnsToAdd: [],
      columnsToModify: [],
      columnsToDrop: [],
      indexesToCreate: []
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
        // Table exists - check columns
        const existingColumns = new Map(
          existingTable.columns.map((col) => [col.name.toLowerCase(), col])
        )

        for (const [attrName, attr] of Object.entries(model.attributes)) {
          const columnName = attr.columnName || attrName
          const existingCol = existingColumns.get(columnName.toLowerCase())

          if (!existingCol) {
            // Column doesn't exist - needs to be added
            diff.columnsToAdd.push({
              tableName,
              columnName,
              ...mapWaterlineToSql(attr, attrName, dbType, model.primaryKey)
            })
          } else {
            // Column exists - check for type differences
            const expected = mapWaterlineToSql(
              attr,
              attrName,
              dbType,
              model.primaryKey
            )
            if (needsModification(existingCol, expected, dbType)) {
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
      // Build a set of indexed column names for quick lookup
      const indexedColumns = new Set()
      for (const idx of existingIndexes) {
        // Single-column indexes: track by column name
        if (idx.columns && idx.columns.length === 1) {
          indexedColumns.add(idx.columns[0].toLowerCase())
        }
      }

      for (const [attrName, attr] of Object.entries(model.attributes)) {
        const columnName = attr.columnName || attrName
        const needsIndex = attr.unique || attr.index

        if (needsIndex && !indexedColumns.has(columnName.toLowerCase())) {
          // Check it's not the primary key (PKs already have indexes)
          const isPK = attrName === model.primaryKey || attr.primaryKey
          if (!isPK) {
            diff.indexesToCreate.push({
              tableName,
              columnName,
              unique: attr.unique || false
            })
          }
        }
      }
    }

    return diff
  }
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
 */
function mapWaterlineToSql(attr, attrName, dbType, modelPrimaryKey) {
  // If explicit columnType is set, use it directly (adapters do this too)
  if (attr.columnType) {
    return {
      sqlType:
        dbType === 'sqlite'
          ? normalizeSqlitePhysicalType(attr.columnType)
          : attr.columnType,
      nullable: !attr.required && attr.allowNull !== false,
      defaultValue: attr.defaultsTo,
      autoIncrement: attr.autoIncrement || false,
      unique: attr.unique || false,
      primaryKey: attr.primaryKey || attrName === modelPrimaryKey
    }
  }

  const isPrimaryKey = attr.primaryKey || attrName === modelPrimaryKey
  const isAutoIncrement = attr.autoIncrement || false
  const isTimestamp = attr.autoCreatedAt || attr.autoUpdatedAt
  const isForeignKey = attr.foreignKey || false

  // Determine SQL type based on Waterline type and context
  let sqlType

  if (dbType === 'postgresql') {
    sqlType = getPostgresType(
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
    nullable: !attr.required && attr.allowNull !== false,
    defaultValue: attr.defaultsTo,
    autoIncrement: isAutoIncrement,
    unique: attr.unique || false,
    primaryKey: isPrimaryKey
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
    return 'BIGINT'
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
    return 'BIGINT'
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
  const normalizedExisting = normalizeType(existing.type)
  const normalizedExpected = normalizeType(expected.sqlType)

  return !typesMatch(normalizedExisting, normalizedExpected, dbType)
}

/**
 * Normalize a SQL type for comparison by lowercasing and removing length specifiers.
 */
function normalizeType(type) {
  if (!type) return ''

  return type
    .toLowerCase()
    .trim()
    .replace(/\(\d+(?:,\s*\d+)?\)/, '')
}

/**
 * Check if two types are equivalent (accounting for aliases)
 */
function typesMatch(existing, expected, dbType) {
  if (existing === expected) return true

  // PostgreSQL type aliases
  const pgAliases = {
    'character varying': 'varchar',
    'double precision': 'real',
    int4: 'integer',
    int8: 'bigint',
    float8: 'double precision',
    serial: 'integer', // SERIAL is essentially INTEGER with auto-increment
    bigserial: 'bigint',
    'timestamp with time zone': 'timestamptz',
    'timestamp without time zone': 'timestamp'
  }

  // MySQL type aliases
  const mysqlAliases = {
    int: 'integer',
    bool: 'tinyint',
    boolean: 'tinyint'
  }

  const sqliteAliases = {
    int: 'integer',
    bool: 'integer',
    boolean: 'integer',
    varchar: 'text',
    char: 'text',
    character: 'text',
    json: 'text'
  }

  const aliases =
    dbType === 'postgresql'
      ? pgAliases
      : dbType === 'sqlite'
      ? sqliteAliases
      : mysqlAliases

  // Try to match via aliases
  const resolveAlias = (t) => aliases[t] || t

  return resolveAlias(existing) === resolveAlias(expected)
}

function normalizeSqlitePhysicalType(type) {
  const normalized = normalizeType(type)

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
      return normalized ? normalized.toUpperCase() : 'TEXT'
  }
}
