module.exports = {
  friendlyName: 'Apply migration',

  description: 'Execute migration SQL statements against the database.',

  inputs: {
    projectSlug: {
      type: 'string',
      required: true
    },
    environmentSlug: {
      type: 'string',
      defaultsTo: 'production'
    },
    statements: {
      type: 'ref',
      required: true,
      description: 'Array of SQL statements to execute'
    },
    dryRun: {
      type: 'boolean',
      defaultsTo: false,
      description: 'If true, only validate without executing'
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

  fn: async function ({ projectSlug, environmentSlug, statements, dryRun }) {
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
    const serviceId = this.req.query.service
    let dbResult
    try {
      dbResult = await sails.helpers.dock.getDatabaseService(
        environment.id,
        serviceId
      )
    } catch (err) {
      throw { badRequest: 'No database service found for this environment.' }
    }

    const { service } = dbResult

    if (!Array.isArray(statements) || statements.length === 0) {
      throw { badRequest: 'No statements provided.' }
    }

    // Extract SQL from statement objects
    const sqlStatements = statements.map((s) =>
      typeof s === 'string' ? s : s.sql
    )

    if (dryRun) {
      // Just return what would be executed
      return {
        dryRun: true,
        statements: sqlStatements,
        message: 'Dry run complete. No changes made.'
      }
    }

    // Execute each statement
    const results = []
    let successCount = 0
    let errorCount = 0

    for (const sql of sqlStatements) {
      const result = await sails.helpers.dock.executeSql(service, sql)

      if (result.success) {
        successCount++
        results.push({
          sql,
          success: true,
          message: result.message || 'OK'
        })
      } else {
        errorCount++
        results.push({
          sql,
          success: false,
          error: result.error
        })
        // Stop on first error
        break
      }
    }

    // Log the migration
    sails.log.info(
      `[dock] Migration applied in ${project.slug}/${environmentSlug} by ${user.fullName}: ${successCount} succeeded, ${errorCount} failed`
    )

    return {
      success: errorCount === 0,
      executed: successCount,
      failed: errorCount,
      results,
      appliedBy: user.fullName,
      appliedAt: new Date().toISOString()
    }
  }
}
