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
      isIn: ['postgresql', 'mysql'],
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
      columnsToDrop: []
    }

    const existingTables = new Set(Object.keys(schema))
    const modelTables = new Set()

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
          existingTable.columns.map(col => [col.name.toLowerCase(), col])
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
            const expected = mapWaterlineToSql(attr, attrName, dbType, model.primaryKey)
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
      sqlType: attr.columnType,
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

  // Determine SQL type based on Waterline type and context
  let sqlType

  if (dbType === 'postgresql') {
    sqlType = getPostgresType(attr.type, isPrimaryKey, isAutoIncrement, isTimestamp)
  } else {
    sqlType = getMysqlType(attr.type, isPrimaryKey, isAutoIncrement, isTimestamp)
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
 * Get PostgreSQL type for a Waterline type
 */
function getPostgresType(waterlineType, isPrimaryKey, isAutoIncrement, isTimestamp) {
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
      return isPrimaryKey ? 'INTEGER' : 'REAL'

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
function getMysqlType(waterlineType, isPrimaryKey, isAutoIncrement, isTimestamp) {
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
      return isPrimaryKey ? 'INTEGER' : 'REAL'

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
  // Normalize types for comparison
  const normalizedExisting = normalizeType(existing.type, dbType)
  const normalizedExpected = normalizeType(expected.sqlType, dbType)

  // Type comparison with alias handling
  if (!typesMatch(normalizedExisting, normalizedExpected, dbType)) {
    return true
  }

  // Skip nullability check for now - can be too aggressive
  // In practice, most schema changes are about new columns/types

  return false
}

/**
 * Normalize a SQL type for comparison
 */
function normalizeType(type, dbType) {
  if (!type) return ''

  let t = type.toLowerCase().trim()

  // Remove length specifiers for comparison
  t = t.replace(/\(\d+\)/, '')
  t = t.replace(/\(\d+,\s*\d+\)/, '')

  return t
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
    'int4': 'integer',
    'int8': 'bigint',
    'float8': 'double precision',
    'serial': 'integer', // SERIAL is essentially INTEGER with auto-increment
    'bigserial': 'bigint',
    'timestamp with time zone': 'timestamptz',
    'timestamp without time zone': 'timestamp'
  }

  // MySQL type aliases
  const mysqlAliases = {
    'int': 'integer',
    'bool': 'tinyint',
    'boolean': 'tinyint'
  }

  const aliases = dbType === 'postgresql' ? pgAliases : mysqlAliases

  // Try to match via aliases
  const resolveAlias = (t) => aliases[t] || t

  return resolveAlias(existing) === resolveAlias(expected)
}
