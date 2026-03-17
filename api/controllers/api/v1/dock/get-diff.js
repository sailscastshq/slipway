module.exports = {
  friendlyName: 'Get schema diff',

  description:
    'Compare Waterline models with database schema and show differences.',

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
    }
  },

  fn: async function ({ projectSlug, environmentSlug }) {
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
      this.res.status(400)
      return { error: 'No database service found for this environment.' }
    }

    const { service } = dbResult

    const app =
      (await App.findOne({ environment: environment.id, isDefault: true })) ||
      (await App.findOne({ environment: environment.id }))

    // Try to get models - first from running app, then from static files
    let modelsResult
    let modelsSource = 'static'

    if (app && app.status === 'running' && app.containerName) {
      // Try running app first
      modelsResult = await sails.helpers.dock.getModels(app.containerName)
      modelsSource = 'runtime'
    }

    // Fall back to static parsing if runtime failed or app not running
    if (
      !modelsResult ||
      modelsResult.error ||
      Object.keys(modelsResult.models || {}).length === 0
    ) {
      try {
        modelsResult = await sails.helpers.dock.getModelsStatic(project.slug)
        modelsSource = 'static'
      } catch (err) {
        const normalizedError = normalizeModelsReadError(err)

        if (normalizedError.code === 'modelsSourceNotFound') {
          sails.log.warn(
            '[dock] Could not read static models because the source directory is missing.'
          )
        } else {
          sails.log.error('[dock] Could not read models:', err)
        }

        this.res.status(400)
        return {
          error: normalizedError.message,
          code: normalizedError.code,
          diff: emptyDiff(),
          statements: [],
          hasPendingChanges: false,
          modelsSource
        }
      }
    }

    // Get current schema
    const schemaResult = await sails.helpers.dock.getSchema(service)

    if (schemaResult.error) {
      this.res.status(400)
      return { error: `Failed to get schema: ${schemaResult.error}` }
    }

    if (modelsResult.error) {
      this.res.status(400)
      return { error: `Failed to get models: ${modelsResult.error}` }
    }

    // Generate diff
    const diff = await sails.helpers.dock.generateDiff(
      modelsResult.models,
      schemaResult.tables,
      service.type
    )

    // Generate SQL for the diff
    const { statements } = await sails.helpers.dock.generateMigrationSql(
      diff,
      service.type
    )

    return {
      databaseType: service.type,
      diff,
      statements,
      hasPendingChanges: statements.length > 0,
      modelsSource // 'runtime' or 'static'
    }
  }
}

function normalizeModelsReadError(err) {
  if (
    err?.code === 'notFound' ||
    err?.exit === 'notFound' ||
    err === 'notFound'
  ) {
    return {
      code: 'modelsSourceNotFound',
      message:
        'Could not read models because the source directory was not found. Push source code first.'
    }
  }

  return {
    code: 'modelsReadFailed',
    message: 'Could not read models. Push source code first.'
  }
}

function emptyDiff() {
  return {
    tablesToCreate: [],
    tablesToDrop: [],
    columnsToAdd: [],
    columnsToModify: [],
    columnsToDrop: [],
    indexesToCreate: []
  }
}
