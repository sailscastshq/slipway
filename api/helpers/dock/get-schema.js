const fs = require('fs')
const Database = require('better-sqlite3')

module.exports = {
  friendlyName: 'Get database schema',

  description: 'Query information_schema to get current database structure.',

  inputs: {
    service: {
      type: 'ref',
      required: true,
      description: 'Database service object'
    }
  },

  exits: {
    success: {
      description: 'Schema retrieved successfully',
      outputType: 'ref'
    }
  },

  fn: async function ({ service }) {
    let query

    if (service.type === 'sqlite') {
      return getSqliteSchema(service)
    }

    if (service.type === 'postgresql') {
      query = `
        SELECT
          t.table_name,
          c.column_name,
          c.data_type,
          c.character_maximum_length,
          c.is_nullable,
          c.column_default,
          CASE WHEN pk.column_name IS NOT NULL THEN true ELSE false END as is_primary_key
        FROM information_schema.tables t
        JOIN information_schema.columns c
          ON t.table_name = c.table_name
          AND t.table_schema = c.table_schema
        LEFT JOIN (
          SELECT ku.table_name, ku.column_name
          FROM information_schema.table_constraints tc
          JOIN information_schema.key_column_usage ku
            ON tc.constraint_name = ku.constraint_name
            AND tc.table_schema = ku.table_schema
          WHERE tc.constraint_type = 'PRIMARY KEY'
            AND tc.table_schema = 'public'
        ) pk ON c.table_name = pk.table_name AND c.column_name = pk.column_name
        WHERE t.table_schema = 'public'
          AND t.table_type = 'BASE TABLE'
        ORDER BY t.table_name, c.ordinal_position
      `
    } else if (service.type === 'mysql') {
      query = `
        SELECT
          t.TABLE_NAME as table_name,
          c.COLUMN_NAME as column_name,
          c.DATA_TYPE as data_type,
          c.CHARACTER_MAXIMUM_LENGTH as character_maximum_length,
          c.IS_NULLABLE as is_nullable,
          c.COLUMN_DEFAULT as column_default,
          CASE WHEN c.COLUMN_KEY = 'PRI' THEN 'true' ELSE 'false' END as is_primary_key
        FROM information_schema.TABLES t
        JOIN information_schema.COLUMNS c
          ON t.TABLE_NAME = c.TABLE_NAME
          AND t.TABLE_SCHEMA = c.TABLE_SCHEMA
        WHERE t.TABLE_SCHEMA = DATABASE()
          AND t.TABLE_TYPE = 'BASE TABLE'
        ORDER BY t.TABLE_NAME, c.ORDINAL_POSITION
      `
    } else if (service.type === 'mongodb') {
      // MongoDB: sample one document per collection to infer field types
      // Wrap in try-catch to handle empty databases gracefully
      const schemaQuery = `
        (function() {
          try {
            const names = db.getCollectionNames();
            if (!names || names.length === 0) return [];
            return names.sort().map(function(name) {
              try {
                const doc = db.getCollection(name).findOne();
                const fields = doc ? Object.entries(doc).map(function(entry) {
                  var k = entry[0], v = entry[1];
                  var type = v === null ? 'null' : Array.isArray(v) ? 'array' : (v && typeof v === 'object' && v.constructor && v.constructor.name === 'ObjectId') ? 'ObjectId' : typeof v;
                  return { name: k, type: type };
                }) : [];
                return { collection: name, fields: fields };
              } catch (e) {
                return { collection: name, fields: [], error: e.message };
              }
            });
          } catch (e) {
            return [];
          }
        })()
      `.replace(/\n\s*/g, ' ')

      const result = await sails.helpers.dock.executeSql(service, schemaQuery)

      if (!result.success) {
        // For MongoDB, an empty database is not an error
        if (result.error && result.error.includes('No database')) {
          return { tables: {} }
        }
        return { tables: {}, error: result.error }
      }

      // Parse the array of collection schemas from the result
      const tables = {}
      const collections = result.rows || []
      for (const col of collections) {
        if (!col || !col.collection) continue
        const collName = col.collection
        let fields = col.fields
        if (typeof fields === 'string') {
          try {
            fields = JSON.parse(fields)
          } catch (e) {
            fields = []
          }
        }
        tables[collName] = {
          name: collName,
          columns: (fields || []).map((f) => ({
            name: f.name,
            type: f.type,
            maxLength: null,
            nullable: true,
            defaultValue: null,
            primaryKey: f.name === '_id'
          }))
        }
      }

      return { tables }
    } else {
      throw new Error(`Unsupported database type: ${service.type}`)
    }

    const result = await sails.helpers.dock.executeSql(service, query)

    if (!result.success) {
      return { tables: {}, error: result.error }
    }

    // Group columns by table
    const tables = {}
    for (const row of result.rows) {
      const tableName = row.table_name
      if (!tables[tableName]) {
        tables[tableName] = {
          name: tableName,
          columns: [],
          indexes: []
        }
      }

      tables[tableName].columns.push({
        name: row.column_name,
        type: row.data_type,
        maxLength: row.character_maximum_length
          ? parseInt(row.character_maximum_length)
          : null,
        nullable: row.is_nullable === 'YES',
        defaultValue: row.column_default,
        primaryKey: row.is_primary_key === 'true' || row.is_primary_key === true
      })
    }

    // Fetch indexes (excluding primary keys)
    let indexQuery
    if (service.type === 'postgresql') {
      indexQuery = `
        SELECT
          i.indexname as index_name,
          i.tablename as table_name,
          a.attname as column_name,
          ix.indisunique as is_unique
        FROM pg_indexes i
        JOIN pg_class c ON c.relname = i.indexname
        JOIN pg_index ix ON ix.indexrelid = c.oid
        JOIN pg_attribute a ON a.attrelid = ix.indrelid AND a.attnum = ANY(ix.indkey)
        WHERE i.schemaname = 'public'
          AND ix.indisprimary = false
        ORDER BY i.tablename, i.indexname, a.attnum
      `
    } else {
      indexQuery = `
        SELECT
          TABLE_NAME as table_name,
          INDEX_NAME as index_name,
          COLUMN_NAME as column_name,
          NON_UNIQUE as non_unique
        FROM information_schema.STATISTICS
        WHERE TABLE_SCHEMA = DATABASE()
          AND INDEX_NAME != 'PRIMARY'
        ORDER BY TABLE_NAME, INDEX_NAME, SEQ_IN_INDEX
      `
    }

    const indexResult = await sails.helpers.dock.executeSql(service, indexQuery)

    if (indexResult.success && indexResult.rows) {
      const isPostgres = service.type === 'postgresql'

      // Group index rows by table + index name
      const indexMap = {}
      for (const row of indexResult.rows) {
        const key = `${row.table_name}::${row.index_name}`

        if (!indexMap[key]) {
          const isUnique = isPostgres
            ? row.is_unique === true || row.is_unique === 't'
            : row.non_unique === 0 || row.non_unique === '0'
          indexMap[key] = {
            name: row.index_name,
            tableName: row.table_name,
            columns: [],
            unique: isUnique
          }
        }
        indexMap[key].columns.push(row.column_name)
      }

      // Attach indexes to their tables
      for (const idx of Object.values(indexMap)) {
        if (tables[idx.tableName]) {
          tables[idx.tableName].indexes.push({
            name: idx.name,
            columns: idx.columns,
            unique: idx.unique
          })
        }
      }
    }

    return { tables }
  }
}

function getSqliteSchema(service) {
  if (!service.path || !fs.existsSync(service.path)) {
    return { tables: {}, error: 'Database file not found' }
  }

  let db

  try {
    db = new Database(service.path, { readonly: true })
    const tableRows = db
      .prepare(
        `
      SELECT name
      FROM sqlite_master
      WHERE type = 'table'
        AND name NOT LIKE 'sqlite_%'
      ORDER BY name
    `
      )
      .all()

    const tables = {}

    for (const { name } of tableRows) {
      const tableName = escapeSqliteIdentifier(name)
      const columns = db.prepare(`PRAGMA table_info('${tableName}')`).all()
      const indexes = db.prepare(`PRAGMA index_list('${tableName}')`).all()

      tables[name] = {
        name,
        columns: columns.map((column) => ({
          name: column.name,
          type: column.type,
          maxLength: null,
          nullable: column.notnull === 0,
          defaultValue: column.dflt_value,
          primaryKey: column.pk > 0
        })),
        indexes: indexes
          .filter((index) => index.origin !== 'pk')
          .map((index) => {
            const indexName = escapeSqliteIdentifier(index.name)
            const indexColumns = db
              .prepare(`PRAGMA index_info('${indexName}')`)
              .all()
            return {
              name: index.name,
              columns: indexColumns.map((column) => column.name),
              unique: Boolean(index.unique)
            }
          })
      }
    }

    return { tables }
  } catch (error) {
    return { tables: {}, error: error.message }
  } finally {
    if (db) {
      db.close()
    }
  }
}

function escapeSqliteIdentifier(value) {
  return String(value).replace(/'/g, "''")
}
