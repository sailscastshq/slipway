const fs = require('node:fs')
const path = require('node:path')
const crypto = require('node:crypto')
function executorDigest() {
  return (
    'sha256:' +
    crypto
      .createHash('sha256')
      .update(
        fs.readFileSync(
          path.resolve(__dirname, '../../../bin/ci-server-executor.cjs')
        )
      )
      .digest('hex')
  )
}
function verify(run, policy, checksOnly = false) {
  const summary = run?.summary
  return !!(
    policy?.enabled &&
    (checksOnly
      ? policy.configuration?.pullRequests === true
      : policy.configuration?.automatic === true) &&
    run?.runner == null &&
    run.state === 'passed' &&
    run.policyRevision === policy.revision &&
    run.challenge?.purpose ===
      (checksOnly ? 'checks-only-source-v1' : 'server-source-v1') &&
    summary?.origin === 'server' &&
    summary.state === 'passed' &&
    summary.sourceRevision === run.commit &&
    summary.scope === 'source-checks-only' &&
    summary.deployable === false &&
    summary.cleanup?.state === 'completed' &&
    summary.serverProof?.executorDigest === executorDigest() &&
    summary.serverProof?.reportHash === run.receiptHash &&
    summary.serverProof?.checkNetwork === 'disconnected' &&
    summary.runtime?.image === policy.configuration.execution.runtime &&
    summary.runtime?.architecture ===
      policy.configuration.execution.platform.split('/')[1] &&
    /^sha256:[a-f0-9]{64}$/.test(summary.runtime?.imageId || '') &&
    /^v22\.(?:1[2-9]|[2-9][0-9])\./.test(summary.runtime?.node || '') &&
    Number.isFinite(summary.finishedAt) &&
    summary.finishedAt > Date.now() - 3600000 &&
    summary.finishedAt <= Date.now() + 30000 &&
    ['install', 'lint', 'test', 'build'].every(
      (name, index) =>
        summary.steps?.[index]?.name === name &&
        summary.steps[index].state === 'passed' &&
        summary.steps[index].exitCode === 0
    ) &&
    summary.steps.length === 4
  )
}
module.exports = {
  friendlyName: 'Verify server source-check evidence',
  sync: true,
  inputs: {
    run: { type: 'ref', required: true },
    policy: { type: 'ref', required: true },
    checksOnly: { type: 'boolean', defaultsTo: false }
  },
  fn: ({ run, policy, checksOnly }) => verify(run, policy, checksOnly)
}
module.exports._private = { executorDigest, verify }
