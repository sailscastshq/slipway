const plans = require('../../../../lib/migration-plans')
const migrationContext = require('../../../../lib/migration-context')

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
    planId: { type: 'string' },
    planHash: { type: 'string' },
    operationIds: { type: 'ref' }
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

  fn: async function ({
    projectSlug,
    environmentSlug,
    planId,
    planHash,
    operationIds
  }) {
    const user = await User.forRequest(this.req)
    const project = await Project.findOne({ slug: projectSlug }).populate(
      'team'
    )

    if (!project) {
      throw 'notFound'
    }

    if (
      project.team.id !== user.team ||
      !['owner', 'admin'].includes(user.teamRole)
    ) {
      throw 'forbidden'
    }

    const environment = await Environment.findOne({
      project: project.id,
      slug: environmentSlug
    })

    if (!environment) {
      throw 'notFound'
    }

    if (
      this.req.body?.statements !== undefined ||
      this.req.body?.dryRun !== undefined
    )
      throw {
        badRequest: {
          error:
            'Executable SQL is not accepted here. Refresh and submit a server-created migration plan.',
          code: 'invalidMigrationPlan'
        }
      }
    const { service } = await sails.helpers.dock.getDatabaseService(
      environment.id,
      this.req.query.service
    )
    const app =
      (await App.findOne({ environment: environment.id, isDefault: true })) ||
      (await App.findOne({ environment: environment.id }))
    if (!app)
      throw {
        badRequest: {
          error: 'No deployed app is available for this migration.'
        }
      }
    try {
      const target = migrationContext.target(service, {
        kind: 'dock',
        projectId: project.id,
        environmentId: environment.id,
        serviceId: service.id,
        appId: app.id
      })
      const entry = plans.claim({
        id: planId,
        hash: planHash,
        actor: user,
        target,
        operationIds
      })
      return await sails.helpers.dock.applyServerPlan(entry, user)
    } catch (error) {
      throw {
        badRequest: {
          error: error.message,
          code: error.code || 'invalidMigrationPlan'
        }
      }
    }
  }
}
