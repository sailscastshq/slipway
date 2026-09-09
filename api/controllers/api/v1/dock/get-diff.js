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
    },
    badRequest: {
      statusCode: 400
    }
  },

  fn: async function ({ projectSlug, environmentSlug }) {
    const user = await User.forRequest(this.req)
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
      throw {
        badRequest: {
          error: 'No database service found for this environment.'
        }
      }
    }

    const { service } = dbResult

    const app =
      (await App.findOne({ environment: environment.id, isDefault: true })) ||
      (await App.findOne({ environment: environment.id }))

    // Try to get models - first from running app, then from static files
    let modelsResult
    let modelsSource = 'static'

    if (app && app.containerName) {
      // Try running app first
      modelsResult = await sails.helpers.dock.getModels(app.containerName)
      modelsSource = 'runtime'
    }

    // Source-text parsing is diagnostic only; it never replaces a failed runtime snapshot.
    if (!modelsResult) {
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

        throw {
          badRequest: {
            error: normalizedError.message,
            code: normalizedError.code,
            diff: emptyDiff(),
            statements: [],
            hasPendingChanges: false,
            modelsSource
          }
        }
      }
    }

    if (
      modelsResult.error ||
      modelsResult.authoritative !== true ||
      modelsResult.formatVersion !== 1
    ) {
      throw {
        badRequest: {
          error:
            modelsResult.error ||
            'The app schema snapshot is not authoritative. Refresh it from the deployed app before comparing changes.',
          code: 'modelsSnapshotUnavailable',
          authoritative: false,
          statements: []
        }
      }
    }

    // Get current schema
    const schemaResult = await sails.helpers.dock.getSchema(service)

    if (schemaResult.error) {
      throw {
        badRequest: {
          error: `Failed to get schema: ${schemaResult.error}`
        }
      }
    }

    // Generate diff
    const diff = await sails.helpers.dock.generateDiff(
      modelsResult.models,
      schemaResult.tables,
      service.type
    )

    // Generate SQL for the diff
    let { statements } = await sails.helpers.dock.generateMigrationSql(
      diff,
      service.type,
      modelsResult.models,
      schemaResult.tables
    )

    let preflight
    if (
      ['postgresql', 'mysql'].includes(service.type) &&
      statements.length &&
      !statements.some((item) => item.blocked)
    ) {
      preflight = await sails.helpers.dock.preflightNativeMigration(
        service,
        statements,
        schemaResult.tables
      )
      statements = preflight.statements
    }
    const blocked = statements.filter((item) => item.blocked)
    return {
      preflight: preflight
        ? {
            verified: preflight.verified,
            affectedRows: preflight.affectedRows,
            engineImage: preflight.engineImage
          }
        : undefined,
      databaseType: service.type,
      diff,
      state: blocked.length ? 'unverified' : diff.state,
      verification: {
        unsupported: blocked.length
          ? blocked.map((item) => ({
              tableName: item.table || 'Migration',
              columnName: item.column,
              reason: item.reason
            }))
          : diff.unsupported || [],
        preservedObjects: diff.preserved?.length || 0
      },
      statements,
      hasPendingChanges: statements.length > 0,
      hasBlockedChanges: statements.some((statement) => statement.blocked),
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
    columnsToRename: [],
    columnsToAdd: [],
    columnsToModify: [],
    columnsToDrop: [],
    indexesToCreate: []
  }
}
