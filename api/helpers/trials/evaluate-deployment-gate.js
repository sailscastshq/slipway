const hash = /^[a-f0-9]{40}$/
const digest = /^sha256:[a-f0-9]{64}$/
module.exports = {
  friendlyName: 'Evaluate Trials deployment gate',
  description:
    'Fail closed unless a completed run verifies this exact deployment candidate.',
  inputs: {
    run: { type: 'ref', required: true },
    candidate: { type: 'ref', required: true }
  },
  exits: { success: { outputType: 'ref' } },
  fn: async function ({ run, candidate }) {
    const block = (reason) => ({ allowed: false, reason })
    if (run.state !== 'passed' || !Number.isSafeInteger(run.finishedAt))
      return block('Verification has not passed.')
    if (run.cancelRequestedAt != null)
      return block('Verification was cancelled.')
    if (
      !run.steps?.some((step) => step.required) ||
      run.steps.some((step) => step.required && step.state !== 'passed')
    )
      return block('Required checks are missing or incomplete.')
    for (const key of [
      'repositoryId',
      'appId',
      'commit',
      'configRevision',
      'runtimeDigest',
      'servicesRevision',
      'imageDigest'
    ]) {
      if (
        typeof candidate[key] !== 'string' ||
        !candidate[key] ||
        run.identity?.[key] !== candidate[key]
      )
        return block(`The verified ${key} does not match this candidate.`)
    }
    if (
      !hash.test(candidate.commit) ||
      !digest.test(candidate.imageDigest) ||
      !digest.test(candidate.runtimeDigest) ||
      !digest.test(candidate.configRevision) ||
      !digest.test(candidate.servicesRevision)
    )
      return block('Verification identity is incomplete.')
    if (
      run.observedCommit !== candidate.commit ||
      run.observedConfigRevision !== candidate.configRevision ||
      run.verifiedImageDigest !== candidate.imageDigest
    )
      return block(
        'Candidate evidence does not match the verified image and source.'
      )
    if (run.cleanupState !== 'completed')
      return block('Runner cleanup has not been confirmed.')
    if (
      candidate.schemaReviewRequired &&
      candidate.schemaApprovedImageDigest !== candidate.imageDigest
    )
      return block('This exact candidate still needs schema approval.')
    if (
      candidate.intendedVersion &&
      (run.packageVersion !== candidate.intendedVersion ||
        run.lockfileVersion !== candidate.intendedVersion ||
        run.lockfileRootVersion !== candidate.intendedVersion)
    )
      return block('Package, lockfile and intended release versions disagree.')
    return {
      allowed: true,
      imageDigest: candidate.imageDigest,
      commit: candidate.commit
    }
  }
}
