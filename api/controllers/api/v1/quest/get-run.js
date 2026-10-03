const ledger = require('../../../../lib/quest-run-ledger')

module.exports = {
  friendlyName: 'Get Quest run',
  description:
    'Read one execution receipt belonging to the active team, environment and app.',
  inputs: {
    projectSlug: { type: 'string', required: true },
    environmentSlug: { type: 'string', defaultsTo: 'production' },
    appId: { type: 'number' },
    summaryOnly: { type: 'boolean', defaultsTo: false },
    runId: { type: 'string', required: true }
  },
  exits: { notFound: { statusCode: 404 } },
  fn: async function (inputs) {
    const scope = await ledger.resolveScope(this.req, inputs)
    const run = await (inputs.summaryOnly
      ? ledger.getRunSummary
      : ledger.getRun)(scope, inputs.runId)
    if (!run) throw 'notFound'
    return { run }
  }
}
