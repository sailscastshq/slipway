const ledger = require('../../../../lib/quest-run-ledger')

module.exports = {
  friendlyName: 'Get legacy Quest event',
  description:
    'Read one scoped, explicitly legacy Quest telemetry event without inventing a run.',
  inputs: {
    projectSlug: { type: 'string', required: true },
    environmentSlug: { type: 'string', defaultsTo: 'production' },
    appId: { type: 'number' },
    eventId: { type: 'string', required: true }
  },
  exits: { notFound: { statusCode: 404 } },
  fn: async function (inputs) {
    const scope = await ledger.resolveScope(this.req, inputs)
    const event = await ledger.getEvent(scope, inputs.eventId)
    if (!event) throw 'notFound'
    return { event }
  }
}
