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
      const schemaQuery = `db.getCollectionNames().sort().map(name => {
        const doc = db.getCollection(name).findOne();
        const fields = doc ? Object.entries(doc).map(([k, v]) => ({
          name: k,
          type: v === null ? 'null' : Array.isArray(v) ? 'array' : typeof v === 'object' && v.constructor && v.constructor.name === 'ObjectId' ? 'ObjectId' : typeof v
        })) : [];
        return { collection: name, fields: fields };
      })`

      const result = await sails.helpers.dock.executeSql(service, schemaQuery)

      if (!result.success) {
        return { tables: {}, error: result.error }
      }

      // Parse the array of collection schemas from the result
      const tables = {}
      const collections = result.rows
      for (const col of collections) {
        const collName = col.collection
        let fields = col.fields
        if (typeof fields === 'string') {
          try { fields = JSON.parse(fields) } catch (e) { fields = [] }
        }
        tables[collName] = {
          name: collName,
          columns: (fields || []).map(f => ({
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
          columns: []
        }
      }

      tables[tableName].columns.push({
        name: row.column_name,
        type: row.data_type,
        maxLength: row.character_maximum_length ? parseInt(row.character_maximum_length) : null,
        nullable: row.is_nullable === 'YES',
        defaultValue: row.column_default,
        primaryKey: row.is_primary_key === 'true' || row.is_primary_key === true
      })
    }

    return { tables }
  }
}
