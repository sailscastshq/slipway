module.exports = {
  friendlyName: 'Import SQL',

  description: 'Import SQL statements into the database.',

  inputs: {
    projectSlug: {
      type: 'string',
      required: true
    },
    environmentSlug: {
      type: 'string',
      defaultsTo: 'production'
    },
    sql: {
      type: 'string',
      required: true,
      description: 'SQL statements to import'
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

  fn: async function ({ projectSlug, environmentSlug, sql }) {
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

    // Basic validation
    if (!sql || !sql.trim()) {
      throw { badRequest: 'Data cannot be empty.' }
    }

    // Security: Block dangerous SQL operations (only for SQL databases)
    if (service.type === 'postgresql' || service.type === 'mysql') {
      const dangerousPatterns = [
        /DROP\s+DATABASE/i,
        /DROP\s+SCHEMA\s+public/i,
        /TRUNCATE\s+.*pg_/i
      ]

      for (const pattern of dangerousPatterns) {
        if (pattern.test(sql)) {
          throw { badRequest: 'This SQL contains operations that are not allowed for security reasons.' }
        }
      }
    }

    try {
      const result = await sails.helpers.dock.importSql(service, sql)

      const logType = service.type === 'mongodb' ? 'data' : 'SQL'
      sails.log.info(`[dock] ${logType} imported into ${project.slug}/${environmentSlug} by ${user.fullName} (${result.statementCount} statements)`)

      return result
    } catch (error) {
      if (error.importFailed) {
        return {
          success: false,
          error: error.importFailed.message
        }
      }
      throw error
    }
  }
}
