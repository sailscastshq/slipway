module.exports = {
  friendlyName: 'Format GitHub CI shadow status',
  description:
    'Describe a local source-check proof honestly without approving deployment or claiming GitHub Actions executed it.',
  inputs: {
    run: { type: 'ref', required: true },
    detailsUrl: { type: 'string', required: true }
  },
  exits: { success: { outputType: 'ref' } },
  fn: async function ({ run, detailsUrl }) {
    if (
      run.prototype !== true ||
      run.scope !== 'source-checks-only' ||
      run.deployable !== false
    )
      throw new Error(
        'Only explicitly non-deployable local shadow evidence is supported.'
      )
    if (!/^[a-f0-9]{40}$/.test(run.sourceRevision || ''))
      throw new Error('An exact source commit is required.')
    const url = new URL(detailsUrl)
    if (url.protocol !== 'https:' || url.username || url.password || url.search)
      throw new Error('Use a credential-free HTTPS evidence URL.')
    let state = 'error',
      description = 'Local shadow outcome unknown; deployment is not approved.'
    if (['queued', 'preparing', 'running'].includes(run.state)) {
      state = 'pending'
      description =
        'Local source checks are pending; no deployment is approved.'
    } else if (
      run.state === 'passed' &&
      run.cleanup?.state === 'completed' &&
      run.steps?.some((step) => step.name === 'install') &&
      run.steps.some((step) => step.name !== 'install') &&
      run.steps.every((step) => step.state === 'passed' && step.exitCode === 0)
    ) {
      state = 'success'
      description =
        'Local install, selected source checks and cleanup passed; deployment is not approved.'
    } else if (
      run.state === 'failed' &&
      run.failureClass === 'code-failed' &&
      run.cleanup?.state === 'completed'
    ) {
      state = 'failure'
      description =
        'Local source check failed; inspect shadow evidence. No deployment was started.'
    } else if (run.state === 'failed') {
      description =
        'Local runner/setup failed; source checks did not pass. Inspect shadow evidence.'
    } else if (run.state === 'interrupted') {
      description =
        'Local runner completion is unknown; verification did not pass.'
    } else if (['cancelled', 'timed-out'].includes(run.state)) {
      description = `Local shadow run ${run.state}; verification did not pass.`
    }
    return {
      sha: run.sourceRevision,
      body: {
        state,
        context: 'Slipway CI (local shadow)',
        target_url: url.href,
        description
      }
    }
  }
}
