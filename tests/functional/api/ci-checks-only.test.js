const { test } = require('sounding')
const assert = require('node:assert/strict')
const crypto = require('node:crypto')
const { createSessionCookie } = require('sounding/lib/create-session-cookie')
const { withCsrfFromPage } = require('../../support/csrf-request')
const contract = require('../../../api/lib/contracts/ci-contract')

test(
  'checks-only dispatch is owner-scoped, idempotent, leased and cannot reserve deployment ownership',
  {
    transport: 'http',
    world: {
      name: 'configured-slipway',
      context: { deploymentTarget: { slug: 'ci-pr-owner' } }
    }
  },
  async ({ sails, world, request, expect }) => {
    const app = world.current.apps.web
    const owner = world.current.users.genesisUser
    const project = world.current.projects.deploymentTarget
    const browser = await withCsrfFromPage(
      request.withHeaders({
        cookie: await createSessionCookie(sails, { userId: owner.id })
      }),
      '/'
    )
    const base = `/api/v1/projects/${project.slug}/environments/production/apps/${app.slug}/ci`
    const execution = contract.configuration(
      {
        scripts: {
          lint: 'node lint.js',
          test: 'node --test',
          build: 'node build.js'
        }
      },
      'node@sha256:' + 'a'.repeat(64),
      'linux/amd64'
    )
    const policy = await sails.models.cipolicy
      .create({
        app: app.id,
        createdBy: owner.id,
        revision: 'pr-policy',
        enabled: true,
        branch: 'main',
        repositoryId: '123',
        configuration: {
          execution,
          configRevision: contract.digest(execution),
          pullRequests: true,
          automatic: false
        }
      })
      .fetch()
    const source = {
      repositoryId: '123',
      commit: 'b'.repeat(40),
      tree: 'c'.repeat(40),
      branch: 'feat/fixture',
      manifest: {
        scripts: {
          lint: 'node lint.js',
          test: 'node --test',
          build: 'node build.js'
        }
      },
      manifestDigest: 'sha256:' + 'd'.repeat(64),
      lockDigest: 'sha256:' + 'e'.repeat(64)
    }
    const saved = {}
    for (const name of [
      'resolvePullRequest',
      'publishJobStatus',
      'runQueuedChecks',
      'cleanupJobContainer'
    ])
      saved[name] = sails.helpers.ci[name]
    const resolve = async ({ policy: current, expectedCommit }) => {
      if (
        current?.configuration?.pullRequests !== true ||
        (expectedCommit && expectedCommit !== source.commit)
      )
        throw new Error('PR source changed')
      return source
    }
    resolve.with = resolve
    sails.helpers.ci.resolvePullRequest = resolve
    const noop = async () => ({})
    noop.with = noop
    sails.helpers.ci.publishJobStatus = noop
    sails.helpers.ci.runQueuedChecks = noop
    sails.helpers.ci.cleanupJobContainer = noop
    try {
      const requestId = crypto.randomUUID()
      const first = await browser.request.post(base + '/checks', {
        pullRequest: 116,
        commit: source.commit,
        requestId
      })
      expect(first).toHaveStatus(200)
      const duplicate = await browser.request.post(base + '/checks', {
        pullRequest: 116,
        commit: source.commit,
        requestId
      })
      expect(duplicate).toHaveStatus(200)
      assert.equal(first.data.job.id, duplicate.data.job.id)
      assert.equal(await sails.models.cijob.count(), 1)
      assert.equal(await sails.models.deployment.count(), 0)
      const stale = await browser.request.post(base + '/checks', {
        pullRequest: 116,
        commit: 'f'.repeat(40),
        requestId: crypto.randomUUID()
      })
      expect(stale).toHaveStatus(400)
      const foreign = await browser.request.post(
        base.replace(project.slug, 'other-team') + '/checks',
        { pullRequest: 116, requestId: crypto.randomUUID() }
      )
      expect(foreign).toHaveStatus(403)
      const member = await world
        .create('user')
        .with({ team: owner.team, teamRole: 'member' })
      const memberBrowser = await withCsrfFromPage(
        request.withHeaders({
          cookie: await createSessionCookie(sails, { userId: member.id })
        }),
        '/'
      )
      expect(
        await memberBrowser.request.post(base + '/checks', {
          pullRequest: 116,
          requestId: crypto.randomUUID()
        })
      ).toHaveStatus(403)
      const token = crypto.randomUUID()
      const job = await sails.models.cijob
        .updateOne({ jobId: first.data.job.id })
        .set({
          state: 'running',
          leaseToken: token,
          leaseExpires: Date.now() + 30000
        })
      await assert.rejects(
        sails.helpers.ci.assertJobLease.with({
          jobId: job.jobId,
          appId: String(app.id),
          policyRevision: policy.revision,
          token: 'wrong'
        }),
        /lost its job lease/
      )
      await sails.helpers.ci.assertJobLease.with({
        jobId: job.jobId,
        appId: String(app.id),
        policyRevision: policy.revision,
        token
      })
      const receipt = await sails.helpers.ci.reserveServerRun.with({
        appId: String(app.id),
        policy,
        source,
        runId: crypto.randomUUID(),
        jobId: job.jobId,
        leaseToken: token,
        summary: { origin: 'server', state: 'preparing' }
      })
      assert.equal(receipt.challenge.purpose, 'checks-only-source-v1')
      assert.equal(receipt.challenge.jobId, job.jobId)
      assert.equal(receipt.challenge.deploymentId, undefined)
      assert.equal(
        (await sails.models.cijob.findOne({ id: job.id })).run,
        receipt.id
      )
      assert.equal(await sails.models.deployment.count(), 0)
      await sails.models.cijob
        .updateOne({ id: job.id })
        .set({ leaseExpires: Date.now() - 1 })
      await require('../../../api/helpers/ci/run-queued-checks').fn()
      assert.equal(
        (await sails.models.cijob.findOne({ id: job.id })).state,
        'cancelled'
      )
      assert.equal(
        (await sails.models.cirun.findOne({ id: receipt.id })).summary.state,
        'interrupted'
      )
      const queued = await browser.request.post(base + '/checks', {
        pullRequest: 116,
        requestId: crypto.randomUUID()
      })
      expect(queued).toHaveStatus(200)
      expect(
        await browser.request.post(base + '/cancel-checks', {
          jobId: queued.data.job.id
        })
      ).toHaveStatus(200)
      assert.equal(
        (await sails.models.cijob.findOne({ jobId: queued.data.job.id })).state,
        'cancelled'
      )
      assert.equal(await sails.models.deployment.count(), 0)
    } finally {
      for (const [name, value] of Object.entries(saved))
        sails.helpers.ci[name] = value
    }
  }
)

test(
  'GitHub reporting serializes delayed old results behind newer same-SHA reruns and quarantines uncertain writers',
  {
    world: {
      name: 'configured-slipway',
      context: { deploymentTarget: { slug: 'ci-pr-reporting' } }
    }
  },
  async ({ sails, world }) => {
    const github = require('../../../api/lib/ci-github')
    const reporter = require('../../../api/helpers/ci/publish-job-status')
    const { executorDigest } =
      require('../../../api/helpers/ci/is-server-evidence')._private
    const previous = {
      connection: github.connection,
      resolve: sails.helpers.ci.resolvePullRequest
    }
    const app = world.current.apps.web,
      project = world.current.projects.deploymentTarget
    const image = 'node@sha256:' + 'a'.repeat(64)
    await sails.models.cipolicy.create({
      app: app.id,
      createdBy: world.current.users.genesisUser.id,
      enabled: true,
      revision: 'report-policy',
      repositoryId: '123',
      branch: 'main',
      configuration: {
        pullRequests: true,
        execution: { runtime: image, platform: 'linux/amd64' }
      }
    })
    const commit = 'b'.repeat(40),
      writes = []
    let release, started
    const startedPromise = new Promise((resolve) => {
      started = resolve
    })
    const gate = new Promise((resolve) => {
      release = resolve
    })
    const createJob = (sha = commit) =>
      sails.models.cijob
        .create({
          jobId: crypto.randomUUID(),
          app: app.id,
          pullRequest: 116,
          branch: 'feat/report-fixture',
          commit: sha,
          policyRevision: 'report-policy',
          dedupeKey: crypto.randomUUID(),
          state: 'queued',
          deadline: Date.now() + 1800000
        })
        .fetch()
    const pass = async (job) => {
      const hash = 'sha256:' + 'c'.repeat(64)
      const receipt = await sails.models.cirun
        .create({
          runId: crypto.randomUUID(),
          app: app.id,
          runner: null,
          policyRevision: 'report-policy',
          commit: job.commit,
          challenge: { purpose: 'checks-only-source-v1', jobId: job.jobId },
          expiresAt: Date.now() + 3600000,
          state: 'passed',
          receiptHash: hash,
          summary: {
            origin: 'server',
            state: 'passed',
            sourceRevision: job.commit,
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
              image,
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
        })
        .fetch()
      await sails.models.cijob
        .updateOne({ id: job.id })
        .set({ state: 'passed', run: receipt.id })
    }
    github.connection = async () => ({
      repository: { externalId: '123' },
      project,
      environment: { slug: 'production' },
      request: async (suffix, options = {}) => {
        if (!suffix) return { id: 123 }
        const body = options.body
        writes.push(body.state)
        if (writes.length === 1) {
          started()
          await gate
        }
        return { id: 100 + writes.length }
      }
    })
    const resolve = async () => ({})
    resolve.with = resolve
    sails.helpers.ci.resolvePullRequest = resolve
    try {
      const old = await createJob()
      await pass(old)
      const pending = reporter.fn({ jobId: old.jobId })
      await startedPromise
      const newer = await createJob()
      await reporter.fn({ jobId: newer.jobId })
      assert.deepEqual(writes, ['success'])
      release()
      await pending
      assert.deepEqual(writes, ['success', 'pending'])
      await reporter.fn({ jobId: old.jobId })
      assert.deepEqual(writes, ['success', 'pending'])
      await pass(newer)
      await reporter.fn({ jobId: newer.jobId })
      assert.deepEqual(writes, ['success', 'pending', 'success'])
      const stuck = await createJob('e'.repeat(40))
      const key = crypto
        .createHash('sha256')
        .update(JSON.stringify([String(app.id), stuck.commit]))
        .digest('hex')
      await sails.models.cireport.create({
        reportKey: key,
        app: app.id,
        commit: stuck.commit,
        leaseToken: 'interrupted-writer',
        leaseExpires: Date.now() - 1
      })
      await assert.rejects(
        reporter.fn({ jobId: stuck.jobId }),
        /ownership is uncertain/
      )
      assert.equal(
        (await sails.models.cireport.findOne({ reportKey: key })).uncertain,
        true
      )
      assert.deepEqual(writes, ['success', 'pending', 'success'])
      const timeout = await createJob('f'.repeat(40))
      github.connection = async () => ({
        repository: { externalId: '123' },
        project,
        environment: { slug: 'production' },
        request: async (suffix) => {
          if (!suffix) return { id: 123 }
          throw new Error('simulated lost HTTP response')
        }
      })
      await assert.rejects(
        reporter.fn({ jobId: timeout.jobId }),
        /lost HTTP response/
      )
      const uncertain = await sails.models.cireport.findOne({
        app: app.id,
        commit: timeout.commit
      })
      assert.equal(uncertain.uncertain, true)
      assert.notEqual(uncertain.leaseToken, '')
      const refused = await createJob('a'.repeat(40))
      let refusals = 0
      github.connection = async () => ({
        repository: { externalId: '123' },
        project,
        environment: { slug: 'production' },
        request: async (suffix) => {
          if (!suffix) return { id: 123 }
          refusals++
          const error = new Error('GitHub POST commit-status denied (HTTP 403)')
          error.status = 403
          throw error
        }
      })
      await assert.rejects(reporter.fn({ jobId: refused.jobId }), /HTTP 403/)
      const blocked = await sails.models.cireport.findOne({
        app: app.id,
        commit: refused.commit
      })
      assert.equal(blocked.deniedStatus, 403)
      assert.equal(blocked.uncertain, false)
      assert.equal(blocked.leaseToken, '')
      await reporter.fn({ jobId: refused.jobId })
      assert.equal(refusals, 1)
      assert.equal(
        (await sails.models.cijob.findOne({ id: refused.id })).githubStatus
          .denied,
        true
      )
    } finally {
      release?.()
      github.connection = previous.connection
      sails.helpers.ci.resolvePullRequest = previous.resolve
    }
  }
)

test(
  'signed PR deliveries queue checks only after reviewed opt-in through canonical and legacy intake',
  {
    transport: 'http',
    world: {
      name: 'configured-slipway',
      context: { deploymentTarget: { slug: 'ci-pr-webhook' } }
    }
  },
  async ({ sails, world, request, expect }) => {
    const app = world.current.apps.web,
      project = world.current.projects.deploymentTarget
    const secret = 'ci-pr-webhook-fixture-secret'
    await sails.models.project
      .updateOne({ id: project.id })
      .set({ webhookSecret: secret })
    const provider = await world
      .create('gitprovider')
      .with({ team: world.current.teams.genesisTeam.id })
    await world.create('gitrepository').with({
      externalId: '5437',
      webhookSecret: secret,
      provider: provider.id,
      environment: app.environment,
      app: app.id
    })
    const policy = await sails.models.cipolicy
      .create({
        app: app.id,
        createdBy: world.current.users.genesisUser.id,
        enabled: true,
        revision: 'reviewed-pr-webhook',
        repositoryId: '5437',
        branch: 'main',
        configuration: { pullRequests: true }
      })
      .fetch()
    const previous = sails.helpers.ci.resolvePullRequest
    const resolve = async () => ({
      commit: 'a'.repeat(40),
      branch: 'feat/webhook-fixture'
    })
    resolve.with = resolve
    sails.helpers.ci.resolvePullRequest = resolve
    const payload = { action: 'opened', number: 42, repository: { id: 5437 } }
    const endpoints = [
      '/webhook/github',
      `/api/v1/webhooks/github/${project.slug}`
    ]
    const baseline = await sails.models.deployment.count()
    const queuedBaseline = await sails.models.cijob.count()
    const send = (endpoint, delivery) =>
      request
        .withHeaders({
          'x-github-event': 'pull_request',
          'x-github-delivery': delivery,
          'x-hub-signature-256':
            'sha256=' +
            crypto
              .createHmac('sha256', secret)
              .update(JSON.stringify(payload))
              .digest('hex')
        })
        .post(endpoint, payload)
    try {
      let identity
      for (const [index, endpoint] of endpoints.entries()) {
        const result = await send(endpoint, `reviewed-pr-${index}`)
        expect(result).toHaveStatus(200)
        expect(result).toHaveJsonPath('action', 'ci_queued')
        assert.equal(result.data.jobs.length, 1)
        identity ||= result.data.jobs[0].id
        assert.equal(result.data.jobs[0].id, identity)
        assert.equal(await sails.models.cijob.count(), queuedBaseline + 1)
        assert.equal(await sails.models.cijob.count({ app: app.id }), 1)
        assert.equal(await sails.models.deployment.count(), baseline)
      }
      await sails.models.cipolicy
        .updateOne({ id: policy.id })
        .set({ enabled: false })
      for (const [index, endpoint] of endpoints.entries()) {
        const ignored = await send(endpoint, `disabled-pr-${index}`)
        expect(ignored).toHaveStatus(200)
        expect(ignored).toHaveJsonPath('action', 'ignored')
        expect(ignored).toHaveJsonPath('reason', 'unsupported_event')
        assert.equal(await sails.models.cijob.count(), queuedBaseline + 1)
        assert.equal(await sails.models.cijob.count({ app: app.id }), 1)
        assert.equal(await sails.models.deployment.count(), baseline)
      }
    } finally {
      sails.helpers.ci.resolvePullRequest = previous
    }
  }
)
