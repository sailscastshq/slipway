const plans = require('../../../../lib/migration-plans')
const migrationContext = require('../../../../lib/migration-context')
const { performance } = require('node:perf_hooks')

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
    },
    refreshModels: { type: 'boolean', defaultsTo: false }
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

  fn: async function ({ projectSlug, environmentSlug, refreshModels = false }) {
    const started = performance.now()
    const timings = {}
    this.res?.set?.('Cache-Control', 'private, no-store')
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
    let schemaPromise
    const readSchema = async () => {
      const at = performance.now()
      try {
        return await sails.helpers.dock.getSchema(service)
      } catch (error) {
        return {
          error: error.message || 'The database catalog could not be read.'
        }
      } finally {
        timings.catalog = performance.now() - at
      }
    }
    const modelsStarted = performance.now()

    if (app && app.status === 'running' && app.containerName) {
      // Try running app first
      schemaPromise = readSchema()
      modelsResult = await sails.helpers.dock.getModels(
        app.containerName,
        true,
        refreshModels
      )
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

    // Get current schema
    timings.models = performance.now() - modelsStarted
    for (const [name, value] of Object.entries(modelsResult.timings || {}))
      if (typeof value === 'number' && Number.isFinite(value))
        timings[name] = value
    const schemaResult = await (schemaPromise || readSchema())

    if (schemaResult.error) {
      throw {
        badRequest: {
          error: `Failed to get schema: ${schemaResult.error}`
        }
      }
    }

    if (modelsResult.error) {
      throw {
        badRequest: {
          error: `Failed to get models: ${modelsResult.error}`
        }
      }
    }

    // Generate diff
    const diffStarted = performance.now()
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
    timings.diff = performance.now() - diffStarted

    // Static parsing restores the preview, but cannot authorize database writes.
    if (modelsSource === 'static') {
      statements = statements.map((item) => ({
        ...item,
        blocked: true,
        reason:
          'This preview was read from source files. A runtime schema is required before applying a migration.'
      }))
    }
    let preflight
    const preflightStarted = performance.now()
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
    timings.preflight = performance.now() - preflightStarted
    let plan
    const planStarted = performance.now()
    if (statements.length && !statements.some((item) => item.blocked)) {
      if (!['sqlite', 'postgresql'].includes(service.type)) {
        statements = statements.map((item) => ({
          ...item,
          blocked: true,
          reason:
            'Automatic migration is unavailable until a whole-plan recovery workflow is verified for this engine. Use a reviewed manual migration with a verified backup.'
        }))
      } else if (['owner', 'admin'].includes(user.teamRole)) {
        const target = migrationContext.target(service, {
          kind: 'dock',
          projectId: project.id,
          environmentId: environment.id,
          serviceId: service.id,
          appId: app.id
        })
        plan = await plans.create({
          actor: user,
          target,
          models: modelsResult.models,
          source: await migrationContext.source(service, app),
          schema: schemaResult.tables,
          statements
        })
        if (plan) statements = plan.statements
      }
    }
    timings.plan = performance.now() - planStarted
    timings.total = performance.now() - started
    this.res?.set?.(
      'Server-Timing',
      Object.entries(timings)
        .map(([name, duration]) => `${name};dur=${duration.toFixed(1)}`)
        .join(', ')
    )
    const blocked = statements.filter((item) => item.blocked)
    return {
      preflight: preflight
        ? {
            verified: preflight.verified,
            affectedRows: preflight.affectedRows,
            engineImage: preflight.engineImage
          }
        : undefined,
      plan: plan
        ? { id: plan.id, hash: plan.hash, expiresAt: plan.expiresAt }
        : null,
      databaseType: service.type,
      // Display identity only. SQL, operation IDs and plan contracts retain
      // physical table/column names; never guess singular forms from SQL names.
      modelLabels: Object.fromEntries(
        Object.entries(modelsResult.models).map(([identity, model]) => [
          model.tableName || identity,
          model.identity || identity
        ])
      ),
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
