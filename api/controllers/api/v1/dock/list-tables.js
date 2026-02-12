module.exports = {
  friendlyName: 'List tables',

  description: 'List all tables in the database with row counts.',

  inputs: {
    projectSlug: {
      type: 'string',
      required: true
    },
    environmentSlug: {
      type: 'string',
      defaultsTo: 'production'
    }
  },

  exits: {
    success: {
      statusCode: 200
    },
    notFound: {
      statusCode: 404
    },
    forbidden: {
      statusCode: 403
    },
    badRequest: {
      responseType: 'badRequest'
    }
  },

  fn: async function ({ projectSlug, environmentSlug }) {
    const user = await User.findOne({ id: this.req.session.userId })
    const project = await Project.findOne({ slug: projectSlug }).populate('team')

    if (!project) {
      throw 'notFound'
    }

    if (project.team.id !== user.team) {
      throw 'forbidden'
    }

    const environment = await Environment.findOne({
      project: project.id,
      slug: environmentSlug
    })

    if (!environment) {
      throw 'notFound'
    }

    // Get database service
    let dbResult
    try {
      dbResult = await sails.helpers.dock.getDatabaseService(environment.id)
    } catch (err) {
      throw { badRequest: 'No database service found for this environment.' }
    }

    const { service } = dbResult

    let query

    if (service.type === 'postgresql') {
      // Use information_schema for reliable table listing
      // Join with pg_stat_user_tables for row counts (may be 0 for new tables)
      query = `
        SELECT
          t.table_schema as schema_name,
          t.table_name,
          COALESCE(s.n_live_tup, 0) as row_count
        FROM information_schema.tables t
        LEFT JOIN pg_stat_user_tables s
          ON t.table_name = s.relname
          AND t.table_schema = s.schemaname
        WHERE t.table_schema = 'public'
          AND t.table_type = 'BASE TABLE'
        ORDER BY t.table_name
      `
    } else if (service.type === 'mysql') {
      query = `
        SELECT
          TABLE_SCHEMA as schema_name,
          TABLE_NAME as table_name,
          TABLE_ROWS as row_count
        FROM information_schema.TABLES
        WHERE TABLE_SCHEMA = DATABASE()
          AND TABLE_TYPE = 'BASE TABLE'
        ORDER BY TABLE_NAME
      `
    } else if (service.type === 'mongodb') {
      // List collections with document counts via mongosh
      query = `db.getCollectionNames().sort().map(name => ({ table_name: name, schema_name: '${service.database}', row_count: db.getCollection(name).estimatedDocumentCount() }))`

      const result = await sails.helpers.dock.executeSql(service, query)

      if (!result.success) {
        throw { badRequest: result.error }
      }

      const tables = result.rows.map(row => ({
        name: row.table_name,
        schema: row.schema_name,
        rowCount: parseInt(row.row_count) || 0
      }))

      return {
        databaseType: service.type,
        database: service.database,
        tables,
        tableCount: tables.length
      }
    }

    const result = await sails.helpers.dock.executeSql(service, query)

    if (!result.success) {
      throw { badRequest: result.error }
    }

    const tables = result.rows.map(row => ({
      name: row.table_name,
      schema: row.schema_name,
      rowCount: parseInt(row.row_count) || 0
    }))

    return {
      databaseType: service.type,
      database: service.database,
      tables,
      tableCount: tables.length
    }
  }
}
