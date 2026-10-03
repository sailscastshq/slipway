const assert = require('node:assert/strict')
const crypto = require('node:crypto')
const { test } = require('sounding')
const ledger = require('../../../api/lib/quest-run-ledger')
const workspace = require('../../../api/lib/quest-workspace')
const runtime = require('../../../api/lib/quest-runtime-client')
const {
  worldFor,
  residentFixture
} = require('../../support/quest-resident-fixture')

// This is real ledger persistence with a synthetic resident transport. The
// separately pinned Docker fixture owns actual child/process recovery proof.
async function runningFixture(context, slug) {
  const f = await residentFixture(context, slug)
  const environment = await context.sails.models.environment.findOne({
    id: context.world.current.environments.production.id
  })
  const target = { app: f.app, environment, user: { teamRole: 'owner' } }
  const scope = { appId: f.app.id, environmentId: environment.id }
  const runId = crypto.randomUUID()
  f.bridge.record('running', {
    name: f.job.name,
    runId,
    runtimeId: f.info.runtimeId,
    sequence: 1,
    startedAt: Date.now() - 1000,
    inputs: { count: 0 }
  })
  await workspace.synchronizeRun(target, f.bridge.runs.get(runId))
  await context.sails.models.questrun
    .updateOne({ runId })
    .set({ updatedAt: Date.now() - 50 })
  const original = await ledger.getRun(scope, runId)
  return { ...f, target, scope, runId, original }
}
const afterObservation = () => new Promise((resolve) => setTimeout(resolve, 5))

test(
  'Quest stopped and unreadable resident observations remain provisional and same-sequence verified running evidence recovers without replay',
  { world: worldFor('quest-evidence-recovery') },
  async (context) => {
    const f = await runningFixture(context, 'quest-evidence-recovery')
    const request = runtime.request
    try {
      const stopped = { ...f.target, app: { ...f.app, status: 'stopped' } }
      const beforeCalls = f.calls.length
      await workspace.snapshot(stopped, { fresh: true })
      assert.equal(
        f.calls.length,
        beforeCalls,
        'A stopped app requires no runtime command'
      )
      let run = await ledger.getRun(f.scope, f.runId)
      assert.equal(run.state, 'unconfirmed')
      assert.match(run.error, /app is stopped/)
      for (const field of [
        'sequence',
        'startedAt',
        'finishedAt',
        'duration',
        'exitCode',
        'result'
      ])
        assert.deepEqual(run[field], f.original[field], field)
      await ledger.ingest(f.bridge.runs.get(f.runId), f.scope)
      assert.equal((await ledger.getRun(f.scope, f.runId)).state, 'unconfirmed')
      await afterObservation()
      await workspace.snapshot(f.target, { fresh: true })
      run = await ledger.getRun(f.scope, f.runId)
      assert.equal(
        run.state,
        'running',
        'Cached prior resident reads do not suppress recovery'
      )
      assert.equal(run.error, null)
      assert.equal(run.sequence, 1)

      await afterObservation()
      runtime.request = async () => {
        throw new Error('Synthetic transport loss')
      }
      await workspace.snapshot(f.target, { fresh: true })
      run = await ledger.getRun(f.scope, f.runId)
      assert.equal(run.state, 'unconfirmed')
      assert.match(run.error, /could not be read/)
      assert.doesNotMatch(run.error, /app is stopped/)
      assert.equal(run.finishedAt, null)
      assert.equal(run.exitCode, null)
      runtime.request = request
      await afterObservation()
      await workspace.snapshot(f.target, { fresh: true })
      assert.equal((await ledger.getRun(f.scope, f.runId)).state, 'running')
      assert.equal(f.starts.length, 0)
      assert.ok(
        f.calls.every(({ command }) => ['snapshot', 'run'].includes(command))
      )
    } finally {
      runtime.request = request
      f.restore()
    }
  }
)

test(
  'Quest same-runtime retained-evidence loss stays unknown until a later canonical terminal receipt arrives',
  { world: worldFor('quest-receipt-eviction') },
  async (context) => {
    const f = await runningFixture(context, 'quest-receipt-eviction')
    try {
      f.bridge.runs.delete(f.runId)
      await workspace.snapshot(f.target, { fresh: true })
      const unknown = await ledger.getRun(f.scope, f.runId)
      assert.equal(unknown.state, 'unconfirmed')
      assert.match(unknown.error, /no longer retains evidence/)
      assert.match(unknown.error, /does not establish/)
      assert.equal(unknown.sequence, 1)
      assert.equal(unknown.finishedAt, null)
      assert.equal(unknown.exitCode, null)
      await ledger.ingest(
        {
          runId: f.runId,
          sequence: 2,
          state: 'completed',
          finishedAt: Date.now(),
          exitCode: 0,
          result: { status: 'available', value: false },
          stdout: 'retained result log',
          stderr: ''
        },
        f.scope
      )
      await workspace.snapshot(f.target, { fresh: true })
      const terminal = await ledger.getRun(f.scope, f.runId)
      assert.equal(terminal.state, 'completed')
      assert.equal(terminal.result.value, false)
      assert.equal(terminal.error, null)
      assert.equal(
        (await ledger.getLogs(f.scope, f.runId)).stdout,
        'retained result log'
      )
      assert.equal(f.starts.length, 0)
    } finally {
      f.restore()
    }
  }
)
