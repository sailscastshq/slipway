module.exports = {
  friendlyName: 'Get table data',

  description: 'Browse data in a specific table with pagination.',

  inputs: {
    projectSlug: {
      type: 'string',
      required: true
    },
    environmentSlug: {
      type: 'string',
      defaultsTo: 'production'
    },
    table: {
      type: 'string',
      required: true,
      description: 'Table name'
    },
    limit: {
      type: 'number',
      defaultsTo: 50,
      min: 1,
      max: 1000
    },
    offset: {
      type: 'number',
      defaultsTo: 0,
      min: 0
    },
    orderBy: {
      type: 'string',
      defaultsTo: 'id'
    },
    order: {
      type: 'string',
      defaultsTo: 'asc',
      isIn: ['asc', 'desc']
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

  fn: async function ({ projectSlug, environmentSlug, table, limit, offset, orderBy, order }) {
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

    // Validate table/collection name (prevent injection)
    if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(table)) {
      throw { badRequest: 'Invalid table name.' }
    }

    // Validate orderBy column name
    if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(orderBy)) {
      throw { badRequest: 'Invalid order by column.' }
    }

    if (service.type === 'mongodb') {
      // MongoDB: browse collection data
      const sortDir = order === 'desc' ? -1 : 1
      const countQuery = `db.getCollection('${table}').countDocuments()`
      const countResult = await sails.helpers.dock.executeSql(service, countQuery)

      if (!countResult.success) {
        throw { badRequest: countResult.error }
      }

      const total = parseInt(countResult.message || '0')

      const dataQuery = `db.getCollection('${table}').find().sort({${orderBy}:${sortDir}}).skip(${offset}).limit(${limit}).toArray()`
      const dataResult = await sails.helpers.dock.executeSql(service, dataQuery)

      if (!dataResult.success) {
        throw { badRequest: dataResult.error }
      }

      const columns = dataResult.columns || []
      return {
        table,
        columns,
        rows: dataResult.rows,
        pagination: {
          total,
          limit,
          offset,
          hasMore: offset + dataResult.rows.length < total
        }
      }
    }

    const quote = service.type === 'mysql' ? '`' : '"'

    // Get column info from information_schema (always works, even for empty tables)
    let columnsQuery
    if (service.type === 'postgresql') {
      columnsQuery = `
        SELECT column_name
        FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = '${table}'
        ORDER BY ordinal_position
      `
    } else {
      columnsQuery = `
        SELECT COLUMN_NAME as column_name
        FROM information_schema.COLUMNS
        WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = '${table}'
        ORDER BY ORDINAL_POSITION
      `
    }

    const columnsResult = await sails.helpers.dock.executeSql(service, columnsQuery)
    const columns = columnsResult.success
      ? columnsResult.rows.map(r => r.column_name.toLowerCase())
      : []

    // Get total count
    const countQuery = `SELECT COUNT(*) as total FROM ${quote}${table}${quote}`
    const countResult = await sails.helpers.dock.executeSql(service, countQuery)

    if (!countResult.success) {
      throw { badRequest: countResult.error }
    }

    const total = parseInt(countResult.rows[0]?.total || 0)

    // Get data
    const dataQuery = `SELECT * FROM ${quote}${table}${quote} ORDER BY ${quote}${orderBy}${quote} ${order.toUpperCase()} LIMIT ${limit} OFFSET ${offset}`
    const dataResult = await sails.helpers.dock.executeSql(service, dataQuery)

    if (!dataResult.success) {
      throw { badRequest: dataResult.error }
    }

    return {
      table,
      columns,
      rows: dataResult.rows,
      pagination: {
        total,
        limit,
        offset,
        hasMore: offset + dataResult.rows.length < total
      }
    }
  }
}
