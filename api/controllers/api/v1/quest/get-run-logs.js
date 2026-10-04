const ledger = require('../../../../lib/quest-run-ledger')

module.exports = {
  friendlyName: 'Get Quest run logs',
  description:
    'Read bounded, redacted logs separately from a Quest result value.',
  inputs: {
    projectSlug: { type: 'string', required: true },
    environmentSlug: { type: 'string', defaultsTo: 'production' },
    appId: { type: 'number' },
    runId: { type: 'string', required: true }
  },
  exits: { notFound: { statusCode: 404 } },
  fn: async function (inputs) {
    const scope = await ledger.resolveScope(this.req, inputs)
    const logs = await ledger.getLogs(scope, inputs.runId)
    if (!logs) throw 'notFound'
    return logs
  }
}
