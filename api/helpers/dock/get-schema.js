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
          format_type(a.atttypid, a.atttypmod) as data_type,
          c.is_identity,
          c.is_generated,
          c.generation_expression,
          c.collation_name,
          c.character_maximum_length,
          c.is_nullable,
          c.column_default,
          CASE WHEN pk.column_name IS NOT NULL THEN true ELSE false END as is_primary_key
        FROM information_schema.tables t
        JOIN information_schema.columns c
          ON t.table_name = c.table_name
          AND t.table_schema = c.table_schema
        JOIN pg_namespace ns ON ns.nspname = c.table_schema
        JOIN pg_class rel ON rel.relnamespace = ns.oid AND rel.relname = c.table_name
        JOIN pg_attribute a ON a.attrelid = rel.oid AND a.attname = c.column_name
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
          c.COLUMN_TYPE as data_type,
          c.EXTRA as extra,
          c.GENERATION_EXPRESSION as generation_expression,
          c.COLLATION_NAME as collation_name,
          c.COLUMN_COMMENT as column_comment,
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
        autoIncrement:
          row.is_identity === 'YES' ||
          /^nextval\(/.test(row.column_default || '') ||
          /auto_increment/i.test(row.extra || ''),
        identity: row.is_identity === 'YES',
        generated: row.generation_expression || null,
        collation: row.collation_name || null,
        extra: row.extra || null,
        comment: row.column_comment || null,
        primaryKey: [true, 'true', 't'].includes(row.is_primary_key)
      })
    }

    // Fetch indexes (excluding primary keys)
    let indexQuery
    if (service.type === 'postgresql') {
      indexQuery = `
        SELECT t.relname as table_name, i.relname as index_name,
          a.attname as column_name, x.indisunique as is_unique,
          pg_get_indexdef(i.oid) as definition_sql,
          pg_get_expr(x.indpred, x.indrelid) as predicate,
          k.position, k.position <= x.indnkeyatts as is_key,
          pg_get_indexdef(i.oid, k.position::int, true) as key_definition,
          (x.indexprs IS NULL AND x.indpred IS NULL AND x.indnkeyatts = x.indnatts
            AND NOT EXISTS (SELECT 1 FROM unnest(x.indclass) oc JOIN pg_opclass op ON op.oid = oc WHERE NOT op.opcdefault)
            AND NOT EXISTS (SELECT 1 FROM unnest(x.indcollation, x.indkey) ic(coll, attnum) JOIN pg_attribute ca ON ca.attrelid = t.oid AND ca.attnum = ic.attnum WHERE ic.coll <> ca.attcollation)) as is_simple
        FROM pg_index x
        JOIN pg_class i ON i.oid = x.indexrelid
        JOIN pg_class t ON t.oid = x.indrelid
        JOIN pg_namespace n ON n.oid = t.relnamespace
        CROSS JOIN LATERAL unnest(x.indkey) WITH ORDINALITY k(attnum, position)
        LEFT JOIN pg_attribute a ON a.attrelid = t.oid AND a.attnum = k.attnum
        WHERE n.nspname = 'public' AND NOT x.indisprimary
        ORDER BY t.relname, i.relname, k.position
      `
    } else {
      indexQuery = `
        SELECT TABLE_NAME as table_name, INDEX_NAME as index_name,
          COLUMN_NAME as column_name, NON_UNIQUE as non_unique,
          SEQ_IN_INDEX as position, SUB_PART as prefix_length,
          COLLATION as collation, INDEX_TYPE as index_type,
          EXPRESSION as expression
        FROM information_schema.STATISTICS
        WHERE TABLE_SCHEMA = DATABASE() AND INDEX_NAME != 'PRIMARY'
        ORDER BY TABLE_NAME, INDEX_NAME, SEQ_IN_INDEX
      `
    }

    const indexResult = await sails.helpers.dock.executeSql(service, indexQuery)

    if (!indexResult.success || !Array.isArray(indexResult.rows)) {
      return {
        tables: {},
        error:
          'Could not inventory database indexes. Schema comparison is unavailable.'
      }
    }
    if (indexResult.success && indexResult.rows) {
      const isPostgres = service.type === 'postgresql'

      // Group index rows by table + index name
      const indexMap = {}
      for (const row of indexResult.rows) {
        const key = `${row.table_name}::${row.index_name}`

        if (!indexMap[key]) {
          const isUnique = isPostgres
            ? row.is_unique === true ||
              row.is_unique === 't' ||
              row.is_unique === 'true'
            : row.non_unique === 0 || row.non_unique === '0'
          indexMap[key] = {
            name: row.index_name,
            tableName: row.table_name,
            columns: [],
            unique: isUnique,
            sql: row.definition_sql || null,
            predicate: row.predicate || null,
            partial: Boolean(row.predicate),
            simple: isPostgres
              ? [true, 't', 'true'].includes(row.is_simple)
              : true,
            definition: []
          }
        }
        indexMap[key].columns.push(row.column_name)
        indexMap[key].definition.push({
          name: row.column_name,
          position: Number(row.position),
          key:
            row.is_key === undefined ||
            [true, 't', 'true'].includes(row.is_key),
          expression: row.expression || row.key_definition || null,
          prefixLength: row.prefix_length ? Number(row.prefix_length) : null,
          collation: row.collation || null
        })
        if (
          row.expression ||
          row.prefix_length ||
          (row.index_type && row.index_type !== 'BTREE')
        )
          indexMap[key].simple = false
      }

      // Attach indexes to their tables
      for (const idx of Object.values(indexMap)) {
        if (tables[idx.tableName]) {
          tables[idx.tableName].indexes.push({
            ...idx
          })
        }
      }
    }

    try {
      await inventoryNativeObjects(service, tables)
    } catch (_) {
      return {
        tables: {},
        error:
          'Could not inventory native database definitions. Schema comparison is unavailable.'
      }
    }
    for (const table of Object.values(tables)) table.catalogComplete = true
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
      SELECT name, sql
      FROM sqlite_schema
      WHERE type = 'table'
        AND name NOT LIKE 'sqlite_%'
      ORDER BY name
    `
      )
      .all()
    const viewRows = db
      .prepare(
        `
      SELECT name, sql
      FROM sqlite_schema
      WHERE type = 'view'
      ORDER BY name
    `
      )
      .all()

    const tables = {}

    for (const { name, sql } of tableRows) {
      const tableName = escapeSqliteIdentifier(name)
      const columns = db.prepare(`PRAGMA table_xinfo('${tableName}')`).all()
      const indexes = db.prepare(`PRAGMA index_list('${tableName}')`).all()
      const foreignKeys = db
        .prepare(`PRAGMA foreign_key_list('${tableName}')`)
        .all()
      const triggers = db
        .prepare(
          `
          SELECT name, sql
          FROM sqlite_schema
          WHERE type = 'trigger' AND tbl_name = ?
          ORDER BY name
        `
        )
        .all(name)

      tables[name] = {
        name,
        sql,
        catalogComplete: !/^CREATE\s+VIRTUAL\s+TABLE/i.test(sql || ''),
        columns: columns.map((column) => ({
          position: column.cid,
          name: column.name,
          type: column.type,
          maxLength: null,
          nullable: column.notnull === 0,
          defaultValue: column.dflt_value,
          primaryKey: column.pk > 0,
          autoIncrement: column.pk > 0 && /\bAUTOINCREMENT\b/i.test(sql || ''),
          generated: column.hidden > 1,
          hidden: column.hidden
        })),
        indexes: indexes
          .filter((index) => index.origin !== 'pk')
          .map((index) => {
            const indexName = escapeSqliteIdentifier(index.name)
            const indexColumns = db
              .prepare(`PRAGMA index_xinfo('${indexName}')`)
              .all()
            const schemaEntry = db
              .prepare(
                `SELECT sql FROM sqlite_schema WHERE type = 'index' AND name = ?`
              )
              .get(index.name)

            return {
              name: index.name,
              columns: indexColumns
                .filter((column) => column.key === 1)
                .map((column) => column.name),
              unique: Boolean(index.unique),
              origin: index.origin,
              partial: Boolean(index.partial),
              sql: schemaEntry?.sql || null,
              definition: indexColumns.map((column) => ({
                position: column.seqno,
                columnId: column.cid,
                name: column.name,
                descending: Boolean(column.desc),
                collation: column.coll,
                key: Boolean(column.key)
              }))
            }
          }),
        foreignKeys: foreignKeys.map((foreignKey) => ({
          id: foreignKey.id,
          sequence: foreignKey.seq,
          table: foreignKey.table,
          from: foreignKey.from,
          to: foreignKey.to,
          onUpdate: foreignKey.on_update,
          onDelete: foreignKey.on_delete,
          match: foreignKey.match
        })),
        triggers,
        // SQLite validates the full schema during table replacement. Keep the
        // complete view inventory so rebuilds can replay transitive dependencies.
        views: viewRows
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

async function inventoryNativeObjects(service, tables) {
  async function rows(query) {
    const result = await sails.helpers.dock.executeSql(service, query)
    if (!result.success || !Array.isArray(result.rows))
      throw new Error('Catalog unavailable')
    return result.rows
  }
  if (service.type === 'postgresql') {
    const constraints = await rows(
      `SELECT t.relname as table_name, c.conname as name, c.contype as type, pg_get_constraintdef(c.oid, true) as sql FROM pg_constraint c JOIN pg_class t ON t.oid = c.conrelid JOIN pg_namespace n ON n.oid = t.relnamespace WHERE n.nspname = 'public' ORDER BY t.relname, c.conname`
    )
    const triggers = await rows(
      `SELECT t.relname as table_name, g.tgname as name, pg_get_triggerdef(g.oid, true) as sql FROM pg_trigger g JOIN pg_class t ON t.oid = g.tgrelid JOIN pg_namespace n ON n.oid = t.relnamespace WHERE n.nspname = 'public' AND NOT g.tgisinternal ORDER BY t.relname, g.tgname`
    )
    const views = await rows(
      `SELECT c.relname as name, pg_get_viewdef(c.oid, true) as sql FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace WHERE n.nspname = 'public' AND c.relkind IN ('v', 'm') ORDER BY c.relname`
    )
    for (const table of Object.values(tables)) {
      table.constraints = constraints.filter(
        (row) => row.table_name === table.name
      )
      table.triggers = triggers.filter((row) => row.table_name === table.name)
      table.views = views
    }
  } else {
    const triggers = await rows(
      'SELECT EVENT_OBJECT_TABLE as table_name, TRIGGER_NAME as name, ACTION_STATEMENT as `sql`, ACTION_TIMING as timing, EVENT_MANIPULATION as event FROM information_schema.TRIGGERS WHERE TRIGGER_SCHEMA = DATABASE() ORDER BY EVENT_OBJECT_TABLE, TRIGGER_NAME'
    )
    const views = await rows(
      'SELECT TABLE_NAME as name, VIEW_DEFINITION as `sql`, CHECK_OPTION as check_option, SECURITY_TYPE as security_type FROM information_schema.VIEWS WHERE TABLE_SCHEMA = DATABASE() ORDER BY TABLE_NAME'
    )
    for (const table of Object.values(tables)) {
      const definitions = await rows(
        'SHOW CREATE TABLE `' + table.name.replace(/`/g, '``') + '`'
      )
      const definition = definitions[0]?.['Create Table']
      if (!definition) throw new Error('Table definition unavailable')
      table.sql = definition
      table.triggers = triggers.filter((row) => row.table_name === table.name)
      table.views = views
    }
  }
}
