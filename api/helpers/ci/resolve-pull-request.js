const github = require('../../lib/ci-github')
const contract = require('../../lib/contracts/ci-contract')
module.exports = {
  friendlyName: 'Resolve connected pull request source',
  inputs: {
    app: { type: 'ref', required: true },
    policy: { type: 'ref', required: true },
    pullRequest: { type: 'number', required: true },
    expectedCommit: { type: 'string' }
  },
  fn: async function ({ app, policy, pullRequest, expectedCommit }) {
    if (
      !Number.isSafeInteger(pullRequest) ||
      pullRequest < 1 ||
      !policy?.enabled ||
      policy.configuration?.pullRequests !== true
    )
      throw new Error('Enable reviewed pull request checks first.')
    const { repository, request } = await github.connection(app)
    if (String(repository.externalId) !== String(policy.repositoryId))
      throw new Error('The connected CI repository changed.')
    const pr = await request('/pulls/' + pullRequest)
    if (
      pr.number !== pullRequest ||
      pr.state !== 'open' ||
      String(pr.base?.repo?.id) !== String(policy.repositoryId) ||
      String(pr.head?.repo?.id) !== String(policy.repositoryId) ||
      pr.base?.ref !== policy.branch ||
      !/^[a-f0-9]{40}$/.test(pr.head?.sha || '') ||
      (expectedCommit && pr.head.sha !== expectedCommit)
    ) {
      throw new Error(
        'CI requires an open same-repository pull request targeting the reviewed branch at its current head.'
      )
    }
    const source = await sails.helpers.ci.resolveSource.with({
      app,
      commit: pr.head.sha,
      branch: pr.head.ref
    })
    if (
      source.repositoryId !== policy.repositoryId ||
      contract.digest(
        contract.configuration(
          source.manifest,
          policy.configuration.execution.runtime,
          policy.configuration.execution.platform
        )
      ) !== policy.configuration.configRevision
    )
      throw new Error(
        'Review the changed check commands or runtime before running this pull request.'
      )
    return { ...source, pullRequest }
  }
}
