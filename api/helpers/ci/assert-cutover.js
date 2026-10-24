module.exports = {
  friendlyName: 'Assert CI inside traffic commit',
  inputs: {
    approval: { type: 'ref', required: true },
    appId: { type: 'string', required: true },
    deploymentId: { type: 'string', required: true },
    imageId: { type: 'string', required: true },
    connection: { type: 'ref', required: true }
  },
  fn: async function ({ approval, appId, deploymentId, imageId, connection }) {
    const fail = () => {
      throw new Error(
        'CI trust, policy or the verified deployment candidate changed before traffic commit.'
      )
    }
    if (
      !approval.required ||
      approval.appId !== String(appId) ||
      approval.imageId !== imageId
    )
      fail()
    const [policy, runner, run, verification] = await Promise.all([
      CiPolicy.findOne({ app: appId }).usingConnection(connection),
      CiRunner.findOne({ id: approval.runnerId, app: appId }).usingConnection(
        connection
      ),
      CiRun.findOne({
        id: approval.runId,
        app: appId,
        state: 'passed'
      }).usingConnection(connection),
      CiVerification.findOne({
        id: approval.verificationId,
        app: appId,
        deployment: deploymentId
      }).usingConnection(connection)
    ])
    if (
      !policy?.enabled ||
      policy.revision !== approval.policyRevision ||
      !runner ||
      runner.revokedAt != null ||
      runner.policyRevision !== policy.revision ||
      !run ||
      run.policyRevision !== policy.revision ||
      String(run.runner) !== String(runner.id) ||
      run.commit !== approval.commit ||
      run.summary.scope !== 'source-checks-only' ||
      run.summary.deployable !== false ||
      run.summary.finishedAt < Date.now() - 3600000 ||
      !verification ||
      verification.imageId !== imageId ||
      verification.commit !== approval.commit ||
      verification.runtimeRevision !== approval.runtimeRevision ||
      verification.policyRevision !== policy.revision ||
      String(verification.run) !== approval.runId
    )
      fail()
  }
}
