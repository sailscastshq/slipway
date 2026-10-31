const { test } = require('sounding')
const assert = require('node:assert/strict')
const { executorDigest, verify } =
  require('../../../../api/helpers/ci/is-server-evidence')._private
function evidence() {
  const policy = {
    enabled: true,
    revision: 'reviewed',
    configuration: {
      automatic: true,
      execution: {
        runtime: 'node@sha256:' + 'a'.repeat(64),
        platform: 'linux/amd64'
      }
    }
  }
  const run = {
    runner: null,
    state: 'passed',
    policyRevision: 'reviewed',
    commit: 'b'.repeat(40),
    receiptHash: 'sha256:' + 'c'.repeat(64),
    challenge: { purpose: 'server-source-v1' },
    summary: {
      origin: 'server',
      state: 'passed',
      sourceRevision: 'b'.repeat(40),
      scope: 'source-checks-only',
      deployable: false,
      cleanup: { state: 'completed' },
      finishedAt: Date.now(),
      serverProof: {
        executorDigest: executorDigest(),
        reportHash: 'sha256:' + 'c'.repeat(64),
        checkNetwork: 'disconnected'
      },
      runtime: {
        image: policy.configuration.execution.runtime,
        architecture: 'amd64',
        imageId: 'sha256:' + 'd'.repeat(64),
        node: 'v22.23.4'
      },
      steps: ['install', 'lint', 'test', 'build'].map((name) => ({
        name,
        state: 'passed',
        exitCode: 0
      }))
    }
  }
  return { run, policy }
}
test('native server evidence requires backend provenance, current opt-in policy, every check, cleanup and pinned runtime', () => {
  const { run, policy } = evidence()
  assert.equal(verify(run, policy), true)
  for (const mutate of [
    (value) => {
      value.runner = 1
    },
    (value) => {
      value.challenge.purpose = 'local'
    },
    (value) => {
      value.summary.serverProof.executorDigest = 'wrong'
    },
    (value) => {
      value.summary.serverProof.checkNetwork = 'connected'
    },
    (value) => {
      value.summary.cleanup.state = 'failed'
    },
    (value) => {
      value.summary.steps[2].exitCode = 1
    },
    (value) => {
      value.summary.runtime.architecture = 'arm64'
    },
    (value) => {
      value.summary.finishedAt -= 3600001
    }
  ]) {
    const forged = structuredClone(run)
    mutate(forged)
    assert.equal(verify(forged, policy), false)
  }
  assert.equal(
    verify(run, {
      ...policy,
      configuration: { ...policy.configuration, automatic: false }
    }),
    false
  )
})
test('automatic fallback reuses qualifying local evidence and invokes the server only when evidence is absent', async ({
  sails
}) => {
  const helpers = sails.helpers.ci,
    deploy = sails.helpers.deploy
  const original = {
    admission: helpers.getDeploymentAdmission,
    fallback: helpers.runServerChecks,
    lease: deploy.assertDeploymentLease
  }
  let available = true,
    calls = 0
  const fake = (fn) => Object.assign(fn, { with: fn })
  try {
    deploy.assertDeploymentLease = fake(async () => ({ valid: true }))
    helpers.getDeploymentAdmission = fake(async () =>
      available
        ? { allowed: true, required: true }
        : {
            allowed: false,
            required: true,
            automatic: true,
            policyRevision: 'reviewed',
            reason: 'Waiting'
          }
    )
    helpers.runServerChecks = fake(async () => {
      calls++
      available = true
      return { passed: true }
    })
    const args = {
      appId: '1',
      contextPath: '/fixture',
      deploymentId: '1',
      waitMs: 0
    }
    assert.equal(
      (await helpers.awaitDeploymentAdmission.with(args)).allowed,
      true
    )
    assert.equal(calls, 0)
    // Append logging is independent of evidence dispatch and is covered by the integration case.
    const append = global.Deployment.appendBuildLog
    global.Deployment.appendBuildLog = async () => {}
    try {
      available = false
      assert.equal(
        (await helpers.awaitDeploymentAdmission.with(args)).allowed,
        true
      )
      assert.equal(calls, 1)
    } finally {
      global.Deployment.appendBuildLog = append
    }
  } finally {
    helpers.getDeploymentAdmission = original.admission
    helpers.runServerChecks = original.fallback
    deploy.assertDeploymentLease = original.lease
  }
})
test('a failed server check stops deployment rather than returning to the manual wait loop', async ({
  sails
}) => {
  const original = {
    admission: sails.helpers.ci.getDeploymentAdmission,
    fallback: sails.helpers.ci.runServerChecks,
    lease: sails.helpers.deploy.assertDeploymentLease,
    append: global.Deployment.appendBuildLog
  }
  const fake = (fn) => Object.assign(fn, { with: fn })
  try {
    global.Deployment.appendBuildLog = async () => {}
    sails.helpers.deploy.assertDeploymentLease = fake(async () => ({
      valid: true
    }))
    sails.helpers.ci.getDeploymentAdmission = fake(async () => ({
      allowed: false,
      automatic: true,
      policyRevision: 'reviewed'
    }))
    sails.helpers.ci.runServerChecks = fake(async () => {
      throw new Error('lint failed')
    })
    await assert.rejects(
      sails.helpers.ci.awaitDeploymentAdmission.with({
        appId: '1',
        contextPath: '/fixture',
        deploymentId: '1'
      }),
      /lint failed/
    )
  } finally {
    sails.helpers.ci.getDeploymentAdmission = original.admission
    sails.helpers.ci.runServerChecks = original.fallback
    sails.helpers.deploy.assertDeploymentLease = original.lease
    global.Deployment.appendBuildLog = original.append
  }
})
test('CI stage labels preserve active deployment lifecycle and distinguish waiting, checks and image build', ({
  sails
}) => {
  for (const [stage, label, detail] of [
    ['ci_checks', 'Waiting for CI', 'Waiting for a matching local result'],
    ['ci_capacity', 'Waiting for CI', 'Waiting for CI capacity'],
    ['ci_test', 'Running CI', 'Running tests']
  ]) {
    const result = sails.helpers.deployment.describeOutcome.with({
      deployment: { id: 1, status: 'building' },
      jobStage: stage
    })
    assert.equal(result.status, 'building')
    assert.equal(result.isActive, true)
    assert.equal(result.outcomeLabel, label)
    assert.equal(result.stageLabel, detail)
  }
  assert.equal(
    sails.helpers.deployment.describeOutcome.with({
      deployment: { id: 1, status: 'building' },
      jobStage: 'image_build'
    }).outcomeLabel,
    'Building'
  )
})
test(
  'automatic policy changes require current explicit review and create a new revision without changing commands',
  {
    world: {
      name: 'configured-slipway',
      context: { deploymentTarget: { slug: 'ci-auto-review' } }
    }
  },
  async ({ sails, world }) => {
    const app = world.current.apps.web,
      owner = world.current.users.genesisUser
    const policy = await sails.models.cipolicy
      .create({
        app: app.id,
        revision: 'before',
        repositoryId: '123',
        branch: 'main',
        createdBy: owner.id,
        enabled: true,
        configuration: { execution: { scripts: [] }, configRevision: 'fixed' }
      })
      .fetch()
    const resolve = sails.helpers.ci.resolveAccess
    const access = () => {
      const value = Promise.resolve({ app, user: owner })
      value.tolerate = () => value
      return value
    }
    access.with = access
    sails.helpers.ci.resolveAccess = access
    try {
      const call = (data) =>
        sails.helpers.ci.handleRequest.with({
          req: { method: 'POST' },
          target: {},
          operation: 'policy',
          data
        })
      await assert.rejects(
        call({ automatic: true }),
        /Review the current policy/
      )
      await assert.rejects(
        call({ automatic: true, approvePolicy: true, policyRevision: 'stale' }),
        /Review the current policy/
      )
      const result = await call({
        automatic: true,
        approvePolicy: true,
        policyRevision: policy.revision
      })
      assert.equal(result.policy.configuration.automatic, true)
      assert.equal(result.policy.configuration.configRevision, 'fixed')
      assert.notEqual(result.policy.revision, policy.revision)
    } finally {
      sails.helpers.ci.resolveAccess = resolve
    }
  }
)

test(
  'concurrent server admissions across apps share one capacity slot and disabled fallback cannot reserve it',
  {
    world: {
      name: 'configured-slipway',
      context: { deploymentTarget: { slug: 'ci-capacity-proof' } }
    }
  },
  async ({ sails, world }) => {
    const app = world.current.apps.web,
      owner = world.current.users.genesisUser
    const policy = await sails.models.cipolicy
      .create({
        app: app.id,
        revision: 'capacity',
        repositoryId: '123',
        branch: 'main',
        createdBy: owner.id,
        enabled: true,
        configuration: { automatic: true }
      })
      .fetch()
    const source = {
      commit: 'a'.repeat(40),
      tree: 'b'.repeat(40),
      manifestDigest: 'sha256:' + 'c'.repeat(64),
      lockDigest: 'sha256:' + 'd'.repeat(64)
    }
    const secondApp = await world.create('app').with({
      environment: app.environment,
      name: 'CI worker',
      slug: 'ci-worker',
      isDefault: false
    })
    const secondPolicy = await sails.models.cipolicy
      .create({
        app: secondApp.id,
        revision: 'second-capacity',
        repositoryId: '123',
        branch: 'main',
        createdBy: owner.id,
        enabled: true,
        configuration: { automatic: true }
      })
      .fetch()
    const reserve = (target = app, reviewed = policy) =>
      sails.helpers.ci.reserveServerRun.with({
        appId: target.id,
        policy: reviewed,
        source,
        runId: require('node:crypto').randomUUID(),
        deploymentId: '1',
        summary: { state: 'preparing' }
      })
    const outcomes = await Promise.all([
      reserve(),
      reserve(secondApp, secondPolicy),
      reserve()
    ])
    assert.equal(outcomes.filter(Boolean).length, 1)
    assert.equal(
      (await sails.models.cirun.find({ state: 'pending' })).filter(
        (run) => run.runner == null
      ).length,
      1
    )
    await sails.models.cipolicy
      .updateOne({ id: policy.id })
      .set({ configuration: { automatic: false } })
    await assert.rejects(reserve(), /policy changed/)
  }
)
