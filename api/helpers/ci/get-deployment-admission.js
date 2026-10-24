const { execFile } = require('node:child_process')
const command = require('node:util').promisify(execFile)
const fs = require('node:fs/promises')
const path = require('node:path')
const contract = require('../../../packages/cli/src/lib/ci-contract.cjs')
module.exports = {
  friendlyName: 'Get deployment CI admission',
  description:
    'Accept only current trusted source evidence for the exact clean server checkout. Never approve the deployment image here.',
  inputs: {
    appId: { type: 'string', required: true },
    contextPath: { type: 'string', required: true },
    expectedPolicyRevision: { type: 'string' }
  },
  exits: { success: { outputType: 'ref' } },
  fn: async function ({ appId, contextPath, expectedPolicyRevision }) {
    const policy = await CiPolicy.findOne({ app: appId })
    if (
      expectedPolicyRevision &&
      (!policy?.enabled || policy.revision !== expectedPolicyRevision)
    )
      throw new Error('CI policy changed during deployment verification.')
    if (
      policy?.enabled &&
      policy.configuration.serverVerification !== 'ci-server-verification-v1'
    )
      throw new Error(
        'Review the current server-verification policy before deployment.'
      )
    if (!policy?.enabled) return { required: false, allowed: true }
    const git = async (args) =>
      (
        await command('git', ['-C', contextPath, ...args], {
          timeout: 15000,
          maxBuffer: 16 * 1024 * 1024
        })
      ).stdout.trim()
    let commit, tree, dirty, ignored
    try {
      ;[commit, tree, dirty, ignored] = await Promise.all([
        git(['rev-parse', 'HEAD']),
        git(['rev-parse', 'HEAD^{tree}']),
        git(['status', '--porcelain', '--untracked-files=all']),
        git(['ls-files', '--others', '--ignored', '--exclude-standard'])
      ])
    } catch {
      throw new Error(
        'CI requires an exact connected-repository checkout; pushed archives cannot reuse Git evidence yet.'
      )
    }
    if (
      !/^[a-f0-9]{40}$/.test(commit) ||
      !/^[a-f0-9]{40}$/.test(tree) ||
      dirty ||
      ignored
    )
      throw new Error(
        'The CI deployment checkout differs from its committed source.'
      )
    const [manifestText, lockText] = await Promise.all(
      ['package.json', 'package-lock.json'].map(async (file, index) => {
        const target = path.join(contextPath, file),
          stat = await fs.lstat(target)
        if (
          !stat.isFile() ||
          stat.isSymbolicLink() ||
          stat.size > (index === 0 ? 262144 : 8 * 1024 * 1024)
        )
          throw new Error('CI package metadata must be regular bounded files.')
        return fs.readFile(target, 'utf8')
      })
    )
    if (
      contract.digest(
        contract.configuration(
          JSON.parse(manifestText),
          policy.configuration.execution.runtime,
          policy.configuration.execution.platform
        )
      ) !== policy.configuration.configRevision
    )
      throw new Error(
        'The deployment check commands or executor no longer match the reviewed policy.'
      )
    const app = await App.findOne({ id: appId })
    const repository =
      (await GitRepository.findOne({ app: appId })) ||
      (await GitRepository.findOne({ environment: app.environment }))
    if (!repository || repository.externalId !== policy.repositoryId)
      throw new Error('The connected CI repository changed.')
    const candidates = await CiRun.find({
      app: appId,
      commit,
      policyRevision: policy.revision,
      state: 'passed'
    })
      .sort('completedAt DESC')
      .limit(20)
    for (const run of candidates) {
      if (
        run.challenge.tree !== tree ||
        run.challenge.manifestDigest !== contract.digest(manifestText) ||
        run.challenge.lockDigest !== contract.digest(lockText) ||
        run.summary.finishedAt < Date.now() - 3600000 ||
        run.summary.scope !== 'source-checks-only'
      )
        continue
      const runner = await CiRunner.findOne({ id: run.runner, app: appId })
      if (
        !runner ||
        runner.revokedAt != null ||
        runner.policyRevision !== policy.revision
      )
        continue
      return {
        required: true,
        allowed: true,
        appId: String(appId),
        policyId: String(policy.id),
        policyRevision: policy.revision,
        runnerId: String(runner.id),
        runId: String(run.id),
        commit,
        platform: policy.configuration.execution.platform
      }
    }
    return {
      required: true,
      allowed: false,
      policyRevision: policy.revision,
      commit,
      reason:
        'Waiting for a matching trusted local CI result. Run slipway ci, or submit the retained report after pushing this exact commit.'
    }
  }
}
