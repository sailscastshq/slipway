module.exports = {
  friendlyName: 'Queue verified pull request checks',
  inputs: {
    repository: { type: 'ref', required: true },
    payload: { type: 'ref', required: true }
  },
  fn: async function ({ repository, payload }) {
    if (
      !['opened', 'reopened', 'synchronize', 'ready_for_review'].includes(
        payload.action
      )
    )
      return { received: true, action: 'ignored' }
    const candidates = repository.app
      ? await App.find({ id: repository.app.id || repository.app })
      : await App.find({
          environment: repository.environment.id || repository.environment
        })
    const jobs = []
    for (const app of candidates) {
      const policy = await CiPolicy.findOne({ app: app.id, enabled: true })
      if (
        policy?.configuration?.pullRequests !== true ||
        String(policy.repositoryId) !== String(repository.externalId)
      )
        continue
      // The payload is only a wake-up. GitHub and the connected branch provide
      // authoritative repo, PR, head, package and lock metadata before admission.
      const job = await sails.helpers.ci.queueChecks.with({
        appId: String(app.id),
        pullRequest: payload.number
      })
      jobs.push(job)
    }
    return {
      received: true,
      action: jobs.length ? 'ci_queued' : 'ignored',
      jobs
    }
  }
}
