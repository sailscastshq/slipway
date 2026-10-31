const crypto = require('node:crypto')
const transaction = require('../../lib/with-datastore-transaction')
module.exports = {
  friendlyName: 'Queue checks without deploying',
  inputs: {
    appId: { type: 'string', required: true },
    pullRequest: { type: 'number', required: true },
    expectedCommit: { type: 'string' },
    requestId: { type: 'string' }
  },
  fn: async function ({ appId, pullRequest, expectedCommit, requestId }) {
    if (requestId && !/^[a-f0-9-]{36}$/.test(requestId))
      throw new Error('Use a stable UUID request ID for a manual rerun.')
    const app = await App.findOne({ id: appId })
    const policy = await CiPolicy.findOne({ app: appId })
    const source = await sails.helpers.ci.resolvePullRequest.with({
      app,
      policy,
      pullRequest,
      expectedCommit
    })
    const dedupeKey = crypto
      .createHash('sha256')
      .update(
        JSON.stringify([
          String(appId),
          policy.revision,
          pullRequest,
          source.commit,
          requestId || 'webhook'
        ])
      )
      .digest('hex')
    return transaction(async (connection) => {
      const locked = await CiPolicy.updateOne({
        id: policy.id,
        revision: policy.revision,
        enabled: true
      })
        .set({ revision: policy.revision })
        .usingConnection(connection)
      if (!locked || locked.configuration.pullRequests !== true)
        throw new Error('The CI policy changed before queue admission.')
      await CiJob.update({
        app: appId,
        pullRequest,
        commit: { '!=': source.commit },
        state: ['queued', 'running']
      })
        .set({
          state: 'cancelled',
          reason: 'Superseded by a newer pull request head.',
          leaseToken: null,
          leaseExpires: null
        })
        .usingConnection(connection)
      const existing = await CiJob.findOne({ dedupeKey }).usingConnection(
        connection
      )
      if (existing)
        return {
          id: existing.jobId,
          state: existing.state,
          commit: existing.commit
        }
      const now = Date.now()
      if (
        (await CiJob.count({
          app: appId,
          state: ['queued', 'running']
        }).usingConnection(connection)) >= 10 ||
        (await CiJob.count({
          app: appId,
          createdAt: { '>': now - 3600000 }
        }).usingConnection(connection)) >= 200
      ) {
        throw new Error(
          'CI queue limit reached. Wait for current checks to finish.'
        )
      }
      const job = await CiJob.create({
        jobId: crypto.randomUUID(),
        app: appId,
        pullRequest,
        branch: source.branch,
        commit: source.commit,
        policyRevision: policy.revision,
        dedupeKey,
        state: 'queued',
        deadline: now + 1800000
      })
        .fetch()
        .usingConnection(connection)
      return { id: job.jobId, state: job.state, commit: job.commit }
    })
  }
}
