const withDatastoreTransaction = require('../../lib/with-datastore-transaction')
module.exports = {
  friendlyName: 'Reserve bounded server CI capacity',
  description: 'Serialize a single server job across all apps in the instance.',
  inputs: {
    appId: { type: 'string', required: true },
    policy: { type: 'ref', required: true },
    source: { type: 'ref', required: true },
    runId: { type: 'string', required: true },
    deploymentId: { type: 'string', required: true },
    summary: { type: 'ref', required: true }
  },
  exits: { success: { outputType: 'ref' } },
  fn: async function ({ appId, policy, source, runId, deploymentId, summary }) {
    return withDatastoreTransaction(async (connection) => {
      const now = Date.now()
      const locked = await CiPolicy.updateOne({
        id: policy.id,
        app: appId,
        revision: policy.revision,
        enabled: true
      })
        .set({ revision: policy.revision })
        .usingConnection(connection)
      if (!locked || locked.configuration.automatic !== true)
        throw new Error('CI policy changed before server admission.')
      if (
        await CiRun.count({
          runner: null,
          state: 'pending',
          expiresAt: { '>': now }
        }).usingConnection(connection)
      )
        return null
      if (
        (await CiRun.count({
          app: appId,
          createdAt: { '>': now - 3600000 }
        }).usingConnection(connection)) >= 200
      )
        throw new Error(
          'CI admission limit reached. Retry after current work completes.'
        )
      return CiRun.create({
        runId,
        app: appId,
        runner: null,
        policyRevision: policy.revision,
        commit: source.commit,
        challenge: {
          purpose: 'server-source-v1',
          deploymentId,
          tree: source.tree,
          manifestDigest: source.manifestDigest,
          lockDigest: source.lockDigest
        },
        expiresAt: now + 1440000,
        state: 'pending',
        summary
      })
        .fetch()
        .usingConnection(connection)
    })
  }
}
