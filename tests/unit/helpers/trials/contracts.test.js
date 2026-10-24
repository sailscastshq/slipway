const { test } = require('sounding')
const assert = require('node:assert/strict')
const sha = 'a'.repeat(40)
const digest = (letter) => 'sha256:' + letter.repeat(64)

function evidence() {
  const identity = {
    repositoryId: 'repo-1',
    appId: 'app-1',
    commit: sha,
    configRevision: digest('b'),
    runtimeDigest: digest('c'),
    servicesRevision: digest('d'),
    imageDigest: digest('e')
  }
  return {
    state: 'running',
    identity,
    observedCommit: sha,
    observedConfigRevision: identity.configRevision,
    verifiedImageDigest: identity.imageDigest,
    lease: { expiresAt: 2000 },
    cleanupState: 'completed',
    steps: [
      { id: 'test', required: true, state: 'passed' },
      { id: 'build', required: true, state: 'passed' }
    ],
    packageVersion: '0.0.119',
    lockfileVersion: '0.0.119',
    lockfileRootVersion: '0.0.119'
  }
}

test('Trials suggests scripts as data and never executes discovery code', async ({
  sails
}) => {
  const manifest = {
    name: 'sailsconf',
    packageManager: 'npm@11.11.0',
    engines: { node: '>=22.12' },
    dependencies: {
      sails: '1.5.18',
      'sails-sqlite': '0.2.6',
      'sails-postgresql': '5.0.1'
    },
    devDependencies: { sounding: '0.2.0' },
    scripts: {
      lint: 'prettier --check .',
      'lint:fix': 'MUST_NOT_RUN',
      start: 'MUST_NOT_RUN',
      test: 'MUST_NOT_RUN',
      'test:unit': 'MUST_NOT_RUN',
      'check:bridge': 'MUST_NOT_RUN',
      build: 'MUST_NOT_RUN'
    }
  }
  const original = structuredClone(manifest)
  const plan = await sails.helpers.trials.discoverPlan.with({
    manifest,
    lockfiles: ['package-lock.json']
  })
  assert.deepEqual(manifest, original)
  assert.equal(plan.framework, 'sails')
  assert.equal(plan.testFramework, 'sounding')
  assert.equal(plan.runnable, false)
  assert.equal(plan.requiresApproval, true)
  assert.deepEqual(plan.install.args, ['ci'])
  assert.equal(
    plan.steps.find((step) => step.id === 'test:unit').suggestedRequired,
    false
  )
  assert.equal(
    plan.steps.some((step) => ['start', 'lint:fix'].includes(step.id)),
    false
  )
  assert.equal(
    plan.steps.every((step) => step.approved === false),
    true
  )
  assert.deepEqual(plan.serviceHints, ['postgresql', 'sqlite'])
})

test('Trials blocks ambiguous installs and distinguishes no tests from startup', async ({
  sails
}) => {
  for (const [manifest, lockfiles] of [
    [{}, []],
    [{ packageManager: 'npm@11.11.0' }, ['pnpm-lock.yaml']],
    [{}, ['yarn.lock']],
    [{}, ['package-lock.json', 'pnpm-lock.yaml']],
    [
      { packageManager: 'npm@https://unreviewed.example.test/tool.js' },
      ['package-lock.json']
    ]
  ]) {
    const plan = await sails.helpers.trials.discoverPlan.with({
      manifest,
      lockfiles
    })
    assert.equal(plan.blockers.length > 0, true)
    assert.equal(plan.runnable, false)
    assert.equal(plan.testStatus, 'No tests configured')
  }
  const placeholder = await sails.helpers.trials.discoverPlan.with({
    manifest: {
      scripts: { test: 'echo "Error: no test specified" && exit 1' }
    },
    lockfiles: ['package-lock.json']
  })
  assert.equal(placeholder.testStatus, 'No tests configured')
  assert.equal(placeholder.steps.length, 0)
  const plan = await sails.helpers.trials.discoverPlan.with({
    manifest: { scripts: { start: 'node app.js' } },
    lockfiles: ['package-lock.json']
  })
  assert.equal(plan.testStatus, 'No tests configured')
  assert.equal(plan.steps.length, 0)
})

test('Trials distinguishes Yarn install contracts and npm shrinkwrap precedence', async ({
  sails
}) => {
  for (const [version, expected] of [
    ['1.22.22', '--frozen-lockfile'],
    ['4.9.0', '--immutable']
  ]) {
    const plan = await sails.helpers.trials.discoverPlan.with({
      manifest: { packageManager: `yarn@${version}` },
      lockfiles: ['yarn.lock']
    })
    assert.deepEqual(plan.install.args, ['install', expected])
    assert.deepEqual(plan.blockers, [])
  }
  const npm = await sails.helpers.trials.discoverPlan.with({
    manifest: {},
    lockfiles: ['package-lock.json', 'npm-shrinkwrap.json']
  })
  assert.equal(npm.packageManager.lockfile, 'npm-shrinkwrap.json')
})

test('Trials never passes lost leases, cancelled runs or unchecked work', async ({
  sails
}) => {
  for (const run of [
    { ...evidence(), lease: { expiresAt: 1000 } },
    { ...evidence(), lease: {} },
    { ...evidence(), cancelRequestedAt: 900 },
    { ...evidence(), observedCommit: 'f'.repeat(40) },
    { ...evidence(), identity: {} },
    { ...evidence(), steps: [] },
    { ...evidence(), steps: [{ required: true, state: 'running' }] }
  ]) {
    await assert.rejects(() =>
      sails.helpers.trials.transitionRun.with({
        run,
        nextState: 'passed',
        now: 1000
      })
    )
  }
  const original = evidence()
  const passed = await sails.helpers.trials.transitionRun.with({
    run: original,
    nextState: 'passed',
    now: 1000
  })
  assert.equal(original.state, 'running')
  assert.equal(passed.state, 'passed')
  assert.equal(passed.finishedAt, 1000)
  await assert.rejects(() =>
    sails.helpers.trials.transitionRun.with({
      run: passed,
      nextState: 'running',
      now: 1001
    })
  )
  const interrupted = await sails.helpers.trials.transitionRun.with({
    run: original,
    nextState: 'interrupted',
    now: 1000
  })
  await assert.rejects(() =>
    sails.helpers.trials.transitionRun.with({
      run: interrupted,
      nextState: 'passed',
      now: 1001
    })
  )
})

test('Trials gates the exact repository, app, merge revision, configuration, services and image', async ({
  sails
}) => {
  const run = { ...evidence(), state: 'passed', finishedAt: 1000 }
  const candidate = { ...run.identity, intendedVersion: '0.0.119' }
  assert.equal(
    (await sails.helpers.trials.evaluateDeploymentGate.with({ run, candidate }))
      .allowed,
    true
  )
  for (const key of Object.keys(run.identity)) {
    const result = await sails.helpers.trials.evaluateDeploymentGate.with({
      run,
      candidate: {
        ...candidate,
        [key]: key === 'commit' ? 'f'.repeat(40) : digest('f')
      }
    })
    assert.equal(result.allowed, false, `${key} must bind this exact candidate`)
  }
  for (const invalid of [
    { ...run, state: 'interrupted' },
    { ...run, cleanupState: 'unknown' },
    { ...run, steps: [] },
    { ...run, verifiedImageDigest: digest('f') },
    { ...run, lockfileRootVersion: '0.0.118' },
    { ...run, cancelRequestedAt: 999 }
  ])
    assert.equal(
      (
        await sails.helpers.trials.evaluateDeploymentGate.with({
          run: invalid,
          candidate
        })
      ).allowed,
      false
    )
  assert.equal(
    (
      await sails.helpers.trials.evaluateDeploymentGate.with({
        run,
        candidate: { ...candidate, schemaReviewRequired: true }
      })
    ).allowed,
    false
  )
  assert.equal(
    (
      await sails.helpers.trials.evaluateDeploymentGate.with({
        run,
        candidate: {
          ...candidate,
          schemaReviewRequired: true,
          schemaApprovedImageDigest: candidate.imageDigest
        }
      })
    ).allowed,
    true
  )
})

test('Trials reports external shadow checks against the exact SHA and never turns infrastructure loss green', async ({
  sails
}) => {
  const run = {
    prototype: true,
    scope: 'source-checks-only',
    deployable: false,
    sourceRevision: sha,
    state: 'passed',
    cleanup: { state: 'completed' },
    steps: [
      { name: 'install', state: 'passed', exitCode: 0 },
      { name: 'test', state: 'passed', exitCode: 0 }
    ]
  }
  const format = (values) =>
    sails.helpers.trials.formatGithubShadowStatus.with({
      run: values,
      detailsUrl: 'https://github.com/sailscastshq/slipway/issues/853'
    })
  const passed = await format(run)
  assert.equal(passed.sha, sha)
  assert.equal(passed.body.state, 'success')
  assert.match(passed.body.context, /local shadow/)
  assert.match(passed.body.description, /deployment is not approved/)
  for (const state of ['interrupted', 'timed-out', 'cancelled'])
    assert.equal((await format({ ...run, state })).body.state, 'error')
  assert.equal(
    (await format({ ...run, cleanup: { state: 'unknown' } })).body.state,
    'error'
  )
  assert.equal(
    (await format({ ...run, state: 'failed', failureClass: 'setup-failed' }))
      .body.state,
    'error'
  )
  assert.equal(
    (await format({ ...run, state: 'failed', failureClass: 'code-failed' }))
      .body.state,
    'failure'
  )
  await assert.rejects(() => format({ ...run, deployable: true }))
  await assert.rejects(() => format({ ...run, sourceRevision: 'main' }))
})
