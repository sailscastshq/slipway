const crypto = require('node:crypto')
const ledger = require('./quest-run-ledger')

// Acknowledgements certify retained ledger evidence, never job side effects.
module.exports = async function ingestQuestDelivery(items, environmentId) {
  const acknowledged = []
  for (const item of items || []) {
    const run = item.run
    if (
      crypto.createHash('sha256').update(JSON.stringify(run)).digest('hex') !==
      item.id
    )
      continue
    const app = await App.findOne({ id: run.appId, environment: environmentId })
    if (
      !app ||
      !run.deploymentId ||
      !(await Deployment.findOne({
        id: run.deploymentId,
        environment: environmentId,
        app: app.id
      }))
    )
      continue
    const scope = { environmentId, appId: app.id }
    try {
      await ledger.admitReceipt(run, scope)
      const retained = await ledger.ingest(run, scope)
      if (
        retained &&
        (retained.sequence >= run.sequence ||
          [
            'completed',
            'failed',
            'skipped',
            'cancelled',
            'timed_out',
            'interrupted'
          ].includes(retained.state))
      )
        acknowledged.push(item.id)
    } catch (error) {
      sails.log.warn(
        '[quest] Run delivery remains unconfirmed:',
        error.code || error.name
      )
    }
  }
  return acknowledged
}
