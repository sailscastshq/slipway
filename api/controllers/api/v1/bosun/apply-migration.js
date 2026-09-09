const plans = require('../../../../lib/migration-plans')
const migrationContext = require('../../../../lib/migration-context')

module.exports = {
  friendlyName: 'Apply Bosun migration',

  description:
    'Execute generated SQLite migration statements against a Bosun database.',

  inputs: {
    database: {
      type: 'string',
      defaultsTo: 'app',
      isIn: ['app', 'observability', 'cache']
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
    badRequest: {
      responseType: 'badRequest'
    }
  },

  fn: async function ({ database, planId, planHash, operationIds }) {
    const user = await User.forRequest(this.req)
    if (!user) {
      throw 'notFound'
    }

    if (!user.isGenesisUser)
      throw {
        badRequest: { error: 'Instance administrator access is required.' }
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
    const service = await sails.helpers.bosun.getDatabaseService(database)
    try {
      const target = migrationContext.target(service, {
        kind: 'bosun',
        database
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
