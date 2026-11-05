const withDatastoreTransaction = require('../../lib/with-datastore-transaction')
module.exports = {
  friendlyName: 'Reserve bounded server CI capacity',
  description: 'Serialize a single server job across all apps in the instance.',
  inputs: {
    appId: { type: 'string', required: true },
    policy: { type: 'ref', required: true },
    source: { type: 'ref', required: true },
    runId: { type: 'string', required: true },
    deploymentId: { type: 'string' },
    jobId: { type: 'string' },
    leaseToken: { type: 'string' },
    summary: { type: 'ref', required: true }
  },
  exits: { success: { outputType: 'ref' } },
  fn: async function ({
    appId,
    policy,
    source,
    runId,
    deploymentId,
    jobId,
    leaseToken,
    summary
  }) {
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
      if (
        !locked ||
        (jobId
          ? locked.configuration.pullRequests !== true
          : locked.configuration.automatic !== true)
      )
        throw new Error('CI policy changed before server admission.')
      // Nullable association criteria do not reliably match unassigned runners
      // in the supported SQLite adapter. Inspect bounded active records instead.
      const active = await CiRun.find({
        state: 'pending',
        expiresAt: { '>': now }
      })
        .select(['runner'])
        .limit(1001)
        .usingConnection(connection)
      if (active.length > 1000 || active.some((run) => run.runner == null))
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
      if (jobId) {
        const owner = await CiJob.findOne({
          jobId,
          app: appId,
          state: 'running',
          leaseToken,
          leaseExpires: { '>': now },
          deadline: { '>': now }
        }).usingConnection(connection)
        if (
          !owner ||
          owner.commit !== source.commit ||
          owner.policyRevision !== policy.revision
        )
          throw new Error('CI job lost admission ownership.')
      }
      const run = await CiRun.create({
        runId,
        app: appId,
        runner: null,
        policyRevision: policy.revision,
        commit: source.commit,
        challenge: {
          purpose: jobId ? 'checks-only-source-v1' : 'server-source-v1',
          ...(jobId ? { jobId } : {}),
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
      if (jobId)
        await CiJob.updateOne({ jobId, leaseToken, state: 'running' })
          .set({ run: run.id })
          .usingConnection(connection)
      return run
    })
  }
}
