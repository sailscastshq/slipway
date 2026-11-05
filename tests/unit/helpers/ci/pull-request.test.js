const { test } = require('node:test')
const assert = require('node:assert/strict')
const github = require('../../../../api/lib/ci-github')
const contract = require('../../../../api/lib/contracts/ci-contract')
const helper = require('../../../../api/helpers/ci/resolve-pull-request')
const { verify, executorDigest } =
  require('../../../../api/helpers/ci/is-server-evidence')._private

test('PR verification rejects fork, closed, wrong base, stale head and changed commands before queue admission', async () => {
  const previous = { connection: github.connection, sails: global.sails }
  const manifest = { scripts: { lint: 'lint', test: 'test', build: 'build' } }
  const execution = contract.configuration(
    manifest,
    'node@sha256:' + 'a'.repeat(64),
    'linux/amd64'
  )
  const policy = {
    enabled: true,
    branch: 'main',
    repositoryId: '123',
    configuration: {
      pullRequests: true,
      execution,
      configRevision: contract.digest(execution)
    }
  }
  const good = {
    number: 7,
    state: 'open',
    base: { ref: 'main', repo: { id: 123 } },
    head: { sha: 'b'.repeat(40), ref: 'feat/example', repo: { id: 123 } }
  }
  let pr = good,
    source = {
      commit: good.head.sha,
      repositoryId: '123',
      branch: good.head.ref,
      manifest
    },
    resolutions = 0
  github.connection = async () => ({
    repository: { externalId: '123' },
    request: async () => pr
  })
  global.sails = {
    helpers: {
      ci: {
        resolveSource: {
          with: async () => {
            resolutions++
            return source
          }
        }
      }
    }
  }
  const call = (expectedCommit) =>
    helper.fn({ app: { id: 1 }, policy, pullRequest: 7, expectedCommit })
  try {
    assert.equal((await call(good.head.sha)).commit, good.head.sha)
    for (const edit of [
      (p) => (p.head.repo.id = 999),
      (p) => (p.base.repo.id = 999),
      (p) => (p.state = 'closed'),
      (p) => (p.base.ref = 'other')
    ]) {
      pr = structuredClone(good)
      edit(pr)
      await assert.rejects(call(), /open same-repository/)
    }
    assert.equal(resolutions, 1)
    pr = good
    await assert.rejects(call('c'.repeat(40)), /current head/)
    source = {
      ...source,
      manifest: { scripts: { ...manifest.scripts, test: 'different' } }
    }
    await assert.rejects(call(), /changed check commands/)
  } finally {
    github.connection = previous.connection
    global.sails = previous.sails
  }
})

test('a complete checks-only receipt cannot admit a deployment', () => {
  const policy = {
    enabled: true,
    revision: 'p',
    configuration: {
      automatic: true,
      pullRequests: true,
      execution: {
        runtime: 'node@sha256:' + 'a'.repeat(64),
        platform: 'linux/amd64'
      }
    }
  }
  const hash = 'sha256:' + 'b'.repeat(64)
  const run = {
    runner: null,
    state: 'passed',
    policyRevision: 'p',
    commit: 'c'.repeat(40),
    receiptHash: hash,
    challenge: { purpose: 'checks-only-source-v1' },
    summary: {
      origin: 'server',
      state: 'passed',
      sourceRevision: 'c'.repeat(40),
      scope: 'source-checks-only',
      deployable: false,
      cleanup: { state: 'completed' },
      finishedAt: Date.now(),
      serverProof: {
        executorDigest: executorDigest(),
        reportHash: hash,
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
  assert.equal(verify(run, policy, true), true)
  assert.equal(verify(run, policy), false)
  run.summary.cleanup.state = 'unknown'
  assert.equal(verify(run, policy, true), false)
})
