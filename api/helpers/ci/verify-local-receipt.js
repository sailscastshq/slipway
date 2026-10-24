const crypto = require('node:crypto')
const contract = require('../../../packages/cli/src/lib/ci-contract.cjs')
module.exports = {
  friendlyName: 'Verify trusted local CI receipt',
  inputs: {
    challenge: { type: 'ref', required: true },
    runner: { type: 'ref', required: true },
    policy: { type: 'ref', required: true },
    report: { type: 'ref', required: true },
    signature: { type: 'string', required: true },
    now: { type: 'number', required: true }
  },
  exits: { success: { outputType: 'ref' } },
  fn: async function ({ challenge, runner, policy, report, signature, now }) {
    const fail = () => {
      throw new Error(
        'Local CI evidence is invalid, expired, revoked, or does not match the reviewed policy.'
      )
    }
    if (
      runner.revokedAt != null ||
      !policy.enabled ||
      challenge.policyRevision !== policy.revision ||
      runner.policyRevision !== policy.revision ||
      challenge.runnerId !== runner.runnerId ||
      challenge.appId !== String(policy.app) ||
      challenge.expiresAt <= now
    )
      fail()
    if (
      Buffer.byteLength(JSON.stringify(report)) > 65536 ||
      !/^[A-Za-z0-9_-]{86}$/.test(signature)
    )
      fail()
    let key
    try {
      key = crypto.createPublicKey(runner.publicKey)
    } catch {
      fail()
    }
    if (
      key.asymmetricKeyType !== 'ed25519' ||
      !crypto.verify(
        null,
        Buffer.from(contract.canonical(contract.statement(challenge, report))),
        key,
        Buffer.from(signature, 'base64url')
      )
    )
      fail()
    if (
      report.scope !== 'source-checks-only' ||
      report.deployable !== false ||
      report.cleanup?.state !== 'completed' ||
      !['passed', 'failed'].includes(report.state) ||
      report.sourceRevision !== challenge.commit ||
      report.manifestDigest !== challenge.manifestDigest ||
      report.lockDigest !== challenge.lockDigest ||
      report.configRevision !== policy.configuration.configRevision ||
      contract.digest(report.configuration) !==
        policy.configuration.configRevision ||
      report.runtime?.image !== policy.configuration.execution.runtime ||
      'linux/' + report.runtime?.architecture !==
        policy.configuration.execution.platform
    )
      fail()
    if (
      report.state === 'passed' &&
      (!/^v22\.[0-9]+\.[0-9]+$/.test(report.runtime.node || '') ||
        Number(report.runtime.node.split('.')[1]) < 12 ||
        !/^sha256:[a-f0-9]{64}$/.test(report.runtime.imageId || ''))
    )
      fail()
    const started = Date.parse(report.startedAt),
      finished = Date.parse(report.finishedAt)
    if (
      !Number.isFinite(started) ||
      !Number.isFinite(finished) ||
      started < now - 3600000 ||
      finished < started ||
      finished > now + 30000 ||
      finished - started > 1230000 ||
      !Number.isFinite(report.durationSeconds) ||
      report.durationSeconds < 0 ||
      report.durationSeconds > 1230
    )
      fail()
    if (
      (report.state === 'passed' || report.steps?.length > 1) &&
      report.checkNetwork !== 'disconnected'
    )
      fail()
    const required = [
      'install',
      ...policy.configuration.execution.scripts.map((step) => step.name)
    ]
    if (
      !Array.isArray(report.steps) ||
      !report.steps.length ||
      report.steps.length > required.length
    )
      fail()
    for (const [index, step] of report.steps.entries()) {
      if (
        step.name !== required[index] ||
        !Number.isFinite(step.durationSeconds) ||
        step.durationSeconds < 0 ||
        !Number.isInteger(step.exitCode) ||
        step.exitCode < 0 ||
        step.exitCode > 255 ||
        !['passed', 'failed'].includes(step.state) ||
        (step.state === 'passed') !== (step.exitCode === 0) ||
        (step.state === 'failed' && index !== report.steps.length - 1)
      )
        fail()
    }
    if (
      report.state === 'passed' &&
      (report.steps.length !== required.length ||
        report.steps.some((step) => step.state !== 'passed'))
    )
      fail()
    if (report.state === 'failed' && report.steps.at(-1).state !== 'failed')
      fail()
    return {
      state: report.state,
      receiptHash: contract.digest(report),
      summary: {
        id: challenge.runId,
        title: 'Required lint, tests and build',
        origin: 'trusted-local',
        state: report.state,
        sourceRevision: challenge.commit,
        scope: 'source-checks-only',
        deployable: false,
        durationSeconds: report.durationSeconds,
        runtime: {
          image: report.runtime.image,
          imageId: report.runtime.imageId || null,
          architecture: report.runtime.architecture,
          node: report.runtime.node || null
        },
        steps: report.steps.map(
          ({ name, state, durationSeconds, exitCode }) => ({
            name,
            state,
            durationSeconds,
            exitCode
          })
        ),
        cleanup: { state: 'completed' },
        finishedAt: finished
      }
    }
  }
}
