const workspace = require('../../../../lib/instance-quest-workspace')

module.exports = {
  friendlyName: 'Read retained instance Quest logs',
  inputs: { runId: { type: 'string', required: true } },
  exits: {
    invalid: { statusCode: 400 },
    notFound: { statusCode: 404 },
    unavailable: { statusCode: 503 }
  },
  fn: async function ({ runId }) {
    if (!workspace.UUID.test(runId)) throw 'invalid'
    if (!sails.instanceQuest) throw 'unavailable'
    const snapshot = await sails.instanceQuest.snapshot()
    const source = snapshot.runs?.find((run) => run.id === runId)
    if (!source) throw 'notFound'
    return workspace.logs(source)
  }
}
