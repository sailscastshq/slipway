const assert = require('node:assert/strict')
const crypto = require('node:crypto')
const { test } = require('sounding')
const ledger = require('../../../api/lib/quest-run-ledger')
const workspace = require('../../../api/lib/quest-workspace')
const runtime = require('../../../api/lib/quest-runtime-client')
const questEvent = require('../../../packages/hook/lib/quest-event')
const {
  worldFor,
  residentFixture
} = require('../../support/quest-resident-fixture')

async function telemetryClient(context) {
  const token = `stk_${crypto.randomBytes(24).toString('hex')}`
  await context.sails.models.environment
    .updateOne({ id: context.world.current.environments.production.id })
    .set({
      telemetryTokenHash: crypto
        .createHash('sha256')
        .update(token)
        .digest('hex')
    })
  return context.request.withHeaders({ authorization: `Bearer ${token}` })
}

test(
  'Quest resident receipts enrich telemetry-first results, logs and omitted inputs without rewriting admission or terminal facts',
  { world: worldFor('quest-resident-enrichment') },
  async (context) => {
    const f = await residentFixture(context, 'quest-resident-enrichment')
    const environment = context.world.current.environments.production
    const scope = { appId: f.app.id, environmentId: environment.id }
    const target = { app: f.app, environment }
    const client = await telemetryClient(context)
    try {
      for (const first of ['telemetry', 'resident']) {
        const inputs = {
          enabled: false,
          count: 0,
          label: '',
          payload: { content: 'p'.repeat(5000), empty: null }
        }
        const admitted = await f.bridge.dispatch({
          ...f.body({ jobInputs: inputs }),
          command: 'invoke',
          appId: String(f.app.id),
          deploymentId: String(f.app.currentDeployment),
          name: f.job.name,
          actor: 'Synthetic operator'
        })
        const event = {
          name: f.job.name,
          runId: admitted.run.runId,
          runtimeId: f.info.runtimeId,
          sequence: 2,
          startedAt: admitted.run.startedAt,
          finishedAt: Date.now(),
          duration: 4,
          inputs,
          result: {
            status: 'available',
            exit: 'noRecords',
            value: { count: 0, report: 'r'.repeat(20000) }
          },
          logs: { stdout: 'o'.repeat(6000), stderr: 'w'.repeat(4000) }
        }
        f.bridge.record('completed', event)
        const full = f.bridge.runs.get(event.runId)
        const small = questEvent(event, 'completed', {
          sails: { quest: { metadata: () => f.job } },
          appId: f.app.id,
          deploymentId: f.app.currentDeployment
        })
        for (const field of ['trigger', 'actor', 'requestId', 'requestedAt'])
          small[field] = full[field]
        assert.deepEqual(small.inputs, {})
        assert.equal(small.result.status, 'too_large')
        const deliver = () =>
          client.post('/api/v1/telemetry/ingest', {
            metrics: [
              {
                name: 'quest.job.complete',
                value: 4,
                attributes: { jobName: f.job.name, questRun: small }
              }
            ]
          })
        if (first === 'telemetry') assert.equal((await deliver()).status, 200)
        else await workspace.synchronizeRun(target, full)
        const before = await context.sails.models.questrun.findOne({
          runId: full.runId
        })
        await workspace.synchronizeRun(target, full)
        assert.equal((await deliver()).status, 200)
        await workspace.synchronizeRun(target, full)
        const after = await context.sails.models.questrun.findOne({
          runId: full.runId
        })
        for (const key of [
          'runId',
          'runtimeId',
          'deploymentId',
          'requestKey',
          'inputHash',
          'actor',
          'trigger',
          'state',
          'sequence',
          'requestedAt',
          'startedAt',
          'finishedAt',
          'exitCode',
          'duration'
        ])
          assert.deepEqual(after[key], before[key], `${first}: ${key}`)
        assert.deepEqual(after.inputs, inputs)
        assert.deepEqual(after.result, event.result)
        assert.equal(after.stdout, event.logs.stdout)
        assert.equal(after.stderr, event.logs.stderr)
        assert.equal(after.logsTruncated, false)
        assert.equal(after.logsAvailable, true)
        for (const mismatch of [
          { runtimeId: 'foreign' },
          { deploymentId: 'foreign' },
          { jobName: 'foreign' }
        ]) {
          await assert.rejects(
            ledger.admitReceipt({ ...full, ...mismatch }, scope),
            {
              code: 'QUEST_RUN_CONFLICT'
            }
          )
          await assert.rejects(
            ledger.enrichResidentReceipt({ ...full, ...mismatch }, scope),
            { code: 'QUEST_RUN_CONFLICT' }
          )
        }
        for (const mismatch of [
          { sequence: 1 },
          { sequence: 3 },
          { state: 'failed' }
        ])
          await ledger.enrichResidentReceipt({ ...full, ...mismatch }, scope)
        assert.equal(
          await ledger.enrichResidentReceipt(full, { ...scope, appId: 999999 }),
          null
        )
        const unchanged = await context.sails.models.questrun.findOne({
          runId: full.runId
        })
        assert.deepEqual(unchanged, after)
        await assert.rejects(
          ledger.admit({ ...small, ...scope, inputs: { changed: true } }),
          { code: 'QUEST_RUN_CONFLICT' }
        )
      }
      assert.equal(await context.sails.models.questrun.count(), 2)
      assert.equal(f.starts.length, 2)
    } finally {
      f.restore()
    }
  }
)

test(
  'Quest shared refresh retries a failed equal-sequence receipt read and remembers only successful resident reconciliation',
  { world: worldFor('quest-enrichment-retry') },
  async (context) => {
    const f = await residentFixture(context, 'quest-enrichment-retry')
    const environment = await context.sails.models.environment.findOne({
      id: context.world.current.environments.production.id
    })
    const target = { app: f.app, environment, user: { teamRole: 'owner' } }
    const event = {
      name: f.job.name,
      jobName: f.job.name,
      runId: crypto.randomUUID(),
      runtimeId: f.info.runtimeId,
      deploymentId: String(f.app.currentDeployment),
      sequence: 2,
      state: 'completed',
      inputs: {},
      result: { status: 'available', value: 'r'.repeat(20000) },
      logs: { stdout: 'o'.repeat(6000), stderr: '' }
    }
    const scope = { appId: f.app.id, environmentId: environment.id }
    const request = runtime.request
    let reads = 0
    try {
      f.bridge.record('completed', event)
      const small = {
        ...f.bridge.runs.get(event.runId),
        result: { status: 'too_large' },
        stdout: 'o'.repeat(2048),
        logsTruncated: true
      }
      await ledger.admitReceipt(small, scope)
      await ledger.ingest(small, scope)
      assert.deepEqual(
        await ledger.reconcileRuntimeLoss(scope, f.info.runtimeId),
        {
          checked: 0,
          hasMore: false
        }
      )
      runtime.request = async (...args) => {
        if (args[1] === 'run' && ++reads === 1)
          throw new Error('One disposable transport failure')
        return request(...args)
      }
      await workspace.snapshot(target, { fresh: true })
      assert.equal(
        (await ledger.getRun(scope, event.runId)).result.status,
        'too_large'
      )
      await workspace.snapshot(target, { fresh: true })
      assert.equal(
        (await ledger.getRun(scope, event.runId)).result.status,
        'available'
      )
      await workspace.snapshot(target, { fresh: true })
      assert.equal(reads, 2)
      assert.equal(f.starts.length, 0)
    } finally {
      runtime.request = request
      f.restore()
    }
  }
)

test(
  'Quest restart reconciliation reaches hidden active history in scoped bounded batches without inventing terminal outcomes',
  { world: worldFor('quest-hidden-restart') },
  async (context) => {
    const f = await residentFixture(context, 'quest-hidden-restart')
    const environment = await context.sails.models.environment.findOne({
      id: context.world.current.environments.production.id
    })
    const scope = { appId: f.app.id, environmentId: environment.id }
    const target = { app: f.app, environment, user: { teamRole: 'owner' } }
    const now = Date.now()
    const admit = (extra = {}) =>
      ledger.admit({
        ...scope,
        runId: crypto.randomUUID(),
        jobName: f.job.name,
        deploymentId: String(f.app.currentDeployment),
        runtimeId: 'previous-runtime',
        requestedAt: now - 2000,
        startedAt: now - 2000,
        state: 'running',
        sequence: 1,
        ...extra
      })
    try {
      const hidden = await admit()
      for (let i = 0; i < 100; i++) await admit()
      const untouched = await Promise.all([
        admit({ runtimeId: f.info.runtimeId }),
        admit({ runtimeId: null }),
        admit({ appId: 'different-app' }),
        admit({ environmentId: 'different-environment' })
      ])
      for (let i = 0; i < 30; i++) {
        const run = await admit({ requestedAt: now - 1000 })
        await ledger.ingest(
          { runId: run.runId, sequence: 2, state: 'completed', exitCode: 0 },
          scope
        )
      }
      const page = await ledger.listRuns(scope)
      assert.equal(page.runs.length, 25)
      assert.ok(page.runs.every((run) => run.state === 'completed'))
      assert.equal(
        await context.sails.models.questrun.count({
          app: String(scope.appId),
          environment: String(scope.environmentId),
          state: 'running',
          runtimeId: 'previous-runtime'
        }),
        101
      )
      assert.equal(
        await context.sails.models.questrun.count({
          app: String(scope.appId),
          environment: String(scope.environmentId),
          state: 'running',
          runtimeId: { nin: [f.info.runtimeId, ''] }
        }),
        101
      )
      const first = await workspace.snapshot(target, { fresh: true })
      assert.deepEqual(first.runtimeReconciliation, {
        checked: 100,
        hasMore: true
      })
      const changed = await ledger.getRun(scope, hidden.runId)
      assert.equal(changed.state, 'unconfirmed')
      assert.equal(changed.sequence, 1)
      assert.equal(changed.requestedAt, hidden.requestedAt)
      assert.equal(changed.startedAt, hidden.startedAt)
      assert.equal(changed.finishedAt, null)
      assert.equal(changed.exitCode, null)
      assert.match(changed.error, /runtime changed/)
      const second = await workspace.snapshot(target, { fresh: true })
      assert.deepEqual(second.runtimeReconciliation, {
        checked: 1,
        hasMore: false
      })
      const third = await workspace.snapshot(target, { fresh: true })
      assert.deepEqual(third.runtimeReconciliation, {
        checked: 0,
        hasMore: false
      })
      for (const run of untouched)
        assert.equal(
          (await context.sails.models.questrun.findOne({ runId: run.runId }))
            .state,
          'running'
        )
      await ledger.ingest(
        {
          runId: hidden.runId,
          state: 'completed',
          sequence: 2,
          exitCode: 0,
          result: { status: 'available', value: false }
        },
        scope
      )
      const reconciled = await ledger.getRun(scope, hidden.runId)
      assert.equal(reconciled.state, 'completed')
      assert.equal(reconciled.result.value, false)
      assert.equal(f.starts.length, 0)
    } finally {
      f.restore()
    }
  }
)

test(
  'Quest skipped receipts persist a no-child outcome and unknown origin without rewriting a running execution',
  { world: worldFor('quest-skipped-receipts') },
  async (context) => {
    const f = await residentFixture(context, 'quest-skipped-receipts')
    const scope = {
      appId: f.app.id,
      environmentId: context.world.current.environments.production.id
    }
    const client = await telemetryClient(context)
    try {
      for (const reason of ['paused', 'already_running']) {
        const receipt = questEvent(
          {
            name: f.job.name,
            runId: crypto.randomUUID(),
            runtimeId: f.info.runtimeId,
            sequence: 1,
            startedAt: new Date(),
            timestamp: new Date(),
            reason
          },
          'skipped',
          {
            sails: { quest: { metadata: () => f.job } },
            appId: f.app.id,
            deploymentId: f.app.currentDeployment
          }
        )
        const payload = {
          metrics: [
            {
              name: 'quest.job.skipped',
              value: 0,
              attributes: { questRun: receipt }
            }
          ]
        }
        assert.equal(
          (await client.post('/api/v1/telemetry/ingest', payload)).status,
          200
        )
        assert.equal(
          (await client.post('/api/v1/telemetry/ingest', payload)).status,
          200
        )
        const stored = await ledger.getRun(scope, receipt.runId)
        assert.equal(stored.state, 'skipped')
        assert.equal(stored.trigger, 'unknown')
        assert.equal(stored.error, reason)
        assert.equal(stored.startedAt, null)
        assert.equal(stored.duration, null)
        assert.equal(stored.exitCode, null)
        assert.deepEqual(stored.result, { status: 'unavailable' })
        assert.equal(
          (await ledger.getLogs(scope, receipt.runId)).available,
          false
        )
        await ledger.enrichResidentReceipt(
          {
            ...receipt,
            result: {
              status: 'available',
              value: 'cannot fabricate a business result'
            },
            stdout: 'cannot fabricate child logs',
            stderr: ''
          },
          scope
        )
        assert.deepEqual(await ledger.getRun(scope, receipt.runId), stored)
        assert.equal(
          (await ledger.getLogs(scope, receipt.runId)).available,
          false
        )
      }
      const running = await ledger.admit({
        ...scope,
        runId: crypto.randomUUID(),
        runtimeId: f.info.runtimeId,
        deploymentId: String(f.app.currentDeployment),
        jobName: f.job.name,
        state: 'running',
        sequence: 1,
        startedAt: Date.now()
      })
      await ledger.ingest(
        {
          runId: running.runId,
          state: 'skipped',
          sequence: 2,
          reason: 'paused'
        },
        scope
      )
      const unchanged = await ledger.getRun(scope, running.runId)
      assert.equal(unchanged.state, 'running')
      assert.equal(unchanged.sequence, 1)
      assert.equal(unchanged.startedAt, running.startedAt)
      assert.equal(unchanged.trigger, 'manual') // Actual admission's default stays intact.
      assert.equal((await ledger.listRuns(scope)).runs.length, 3)
      assert.equal((await ledger.listRuns(scope)).legacyEvents.length, 0)
      assert.equal(f.starts.length, 0)
    } finally {
      f.restore()
    }
  }
)
