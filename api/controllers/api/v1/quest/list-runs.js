const ledger = require('../../../../lib/quest-run-ledger')

module.exports = {
  friendlyName: 'List Quest runs',
  description:
    'Read bounded execution summaries and separately identified legacy events.',
  inputs: {
    projectSlug: { type: 'string', required: true },
    environmentSlug: { type: 'string', defaultsTo: 'production' },
    appId: { type: 'number' },
    job: {
      type: 'string',
      description: 'Optional exact job name; nested job paths are supported.'
    },
    cursor: { type: 'string' },
    limit: { type: 'number', defaultsTo: 25 }
  },
  exits: {
    notFound: { statusCode: 404 },
    badRequest: { responseType: 'badRequest' }
  },
  fn: async function (inputs) {
    const scope = await ledger.resolveScope(this.req, inputs)
    try {
      return await ledger.listRuns(scope, inputs)
    } catch (error) {
      if (
        [
          'QUEST_INVALID_CURSOR',
          'QUEST_INVALID_LIMIT',
          'QUEST_INVALID_JOB_FILTER'
        ].includes(error.code)
      )
        throw { badRequest: error.message }
      throw error
    }
  }
}
