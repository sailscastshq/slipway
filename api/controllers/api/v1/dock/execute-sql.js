const {
  getStatementPreview,
  splitSqlStatements
} = require('../../../../lib/dock-sql-results')

module.exports = {
  friendlyName: 'Execute SQL',

  description: 'Execute a SQL query against the database service.',

  inputs: {
    projectSlug: {
      type: 'string',
      required: true
    },
    environmentSlug: {
      type: 'string',
      defaultsTo: 'production'
    },
    query: {
      type: 'string',
      required: true,
      description: 'SQL query to execute'
    },
    serviceId: {
      type: 'string',
      description: 'Specific service ID to query'
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

  fn: async function ({ projectSlug, environmentSlug, query, serviceId }) {
    const user = await User.findOne({ id: this.req.session.userId })
    const project = await Project.findOne({ slug: projectSlug }).populate(
      'team'
    )

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

    // Get database service - use serviceId from query params if available
    const reqServiceId = serviceId || this.req.query.service
    let dbResult
    try {
      dbResult = await sails.helpers.dock.getDatabaseService(
        environment.id,
        reqServiceId
      )
    } catch (err) {
      throw { badRequest: 'No database service found for this environment.' }
    }

    const { service } = dbResult

    // Validate every statement so a dangerous command cannot hide later in a batch.
    const queriesToValidate =
      service.type === 'mongodb'
        ? [query]
        : splitSqlStatements(query, service.type).map((statement) =>
            getStatementPreview(statement.sql, Number.MAX_SAFE_INTEGER)
          )
    const dangerousPatterns =
      service.type === 'mongodb'
        ? [
            /db\.dropDatabase\s*\(/i,
            /\.drop\s*\(\s*\)/i,
            /db\.runCommand\s*\(\s*\{\s*["']?dropDatabase/i,
            /db\.runCommand\s*\(\s*\{\s*["']?shutdown/i
          ]
        : [/^DROP\s+DATABASE/i, /^DROP\s+SCHEMA/i, /^TRUNCATE\s+TABLE\s+pg_/i]

    for (const statement of queriesToValidate) {
      if (dangerousPatterns.some((pattern) => pattern.test(statement))) {
        throw { badRequest: 'This query is not allowed for security reasons.' }
      }
    }

    // Execute the query
    const result = await sails.helpers.dock.executeSql(service, query)

    sails.log.info(
      `[dock] Query executed in ${project.slug}/${environmentSlug} by ${user.fullName}`
    )

    return result
  }
}
