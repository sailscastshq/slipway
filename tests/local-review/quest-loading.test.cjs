const { test } = require('node:test')
const assert = require('node:assert/strict')
const { performance } = require('node:perf_hooks')
const runtime = require('../../api/lib/quest-runtime-client')
const ledger = require('../../api/lib/quest-run-ledger')
const workspace = require('../../api/lib/quest-workspace')
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

async function fixture(run) {
  const originalRuntime = runtime.request
  const originalLedger = Object.fromEntries(
    ['listRuns', 'reconcileRuntimeLoss', 'reconcileUnavailableRuns'].map(
      (key) => [key, ledger[key]]
    )
  )
  const context = {
    user: { teamRole: 'owner' },
    environment: {
      id: 960696,
      features: { 'sails-quest': { scripts: [{ name: 'fixture-job' }] } }
    },
    app: {
      id: 960696,
      status: 'running',
      containerName: 'never-executed',
      currentDeployment: 'one'
    }
  }
  let calls = 0
  let runtimeId = 'runtime-one'
  let fail = false
  runtime.request = async () => {
    calls++
    await delay(100)
    if (fail) throw new Error('synthetic connection failure')
    return {
      version: 1,
      runtimeId,
      observedAt: Date.now(),
      jobs: [{ name: 'fixture-job', paused: false, isRunning: false }],
      runs: [],
      capabilities: { invoke: true }
    }
  }
  ledger.listRuns = async () => ({ runs: [], nextCursor: null })
  ledger.reconcileRuntimeLoss = async () => null
  ledger.reconcileUnavailableRuns = async () => null
  workspace.invalidate(context.app)
  try {
    await run({
      context,
      calls: () => calls,
      restart: () => {
        runtimeId = 'runtime-two'
        context.app.currentDeployment = 'two'
      },
      setFailed: (value) => {
        fail = value
      }
    })
  } finally {
    runtime.request = originalRuntime
    Object.assign(ledger, originalLedger)
    workspace.invalidate(context.app)
  }
}

test('initial page work is independent of delayed resident metadata and shows loading', () =>
  fixture(async ({ context, calls }) => {
    const start = performance.now()
    const initial = await workspace.initialSnapshot(context)
    const elapsed = performance.now() - start
    assert.equal(initial.runtimeState, 'loading')
    assert.equal(initial.reason, null)
    assert.equal(initial.capabilities.invoke, false)
    assert.equal(calls(), 0)
    assert.ok(
      elapsed < 100,
      'Initial snapshot must not wait for resident transport'
    )
    const readStart = performance.now()
    const results = await Promise.all([
      workspace.snapshot(context),
      workspace.snapshot(context)
    ])
    assert.equal(
      calls(),
      1,
      'Concurrent viewers share one bounded metadata read'
    )
    assert.equal(results[0].runtimeState, 'live')
    assert.ok(performance.now() - readStart >= 90)
  }))

test('deployment restart invalidates the cached runtime identity', () =>
  fixture(async ({ context, calls, restart }) => {
    const first = await workspace.snapshot(context)
    restart()
    const next = await workspace.snapshot(context)
    assert.equal(first.target.runtimeId, 'runtime-one')
    assert.equal(next.target.runtimeId, 'runtime-two')
    assert.equal(calls(), 2)
  }))

test('expired cache requests new evidence and fresh reconnect bypasses a failed observation', () =>
  fixture(async ({ context, calls, setFailed }) => {
    await workspace.snapshot(context)
    const originalNow = Date.now
    const clock = originalNow() + 6000
    try {
      Date.now = () => clock
      await workspace.snapshot(context)
      assert.equal(calls(), 2)
    } finally {
      Date.now = originalNow
    }
    setFailed(true)
    const failed = await workspace.snapshot(context, { fresh: true })
    assert.equal(failed.runtimeState, 'unreachable')
    assert.equal(failed.observedAt, null)
    assert.equal(failed.capabilities.invoke, false)
    setFailed(false)
    const recovered = await workspace.snapshot(context, { fresh: true })
    assert.equal(recovered.runtimeState, 'live')
    assert.equal(recovered.capabilities.invoke, true)
    assert.equal(calls(), 4)
  }))

test('stopped apps never present loading or reuse cached live controls', () =>
  fixture(async ({ context, calls }) => {
    await workspace.snapshot(context)
    context.app.status = 'stopped'
    const result = await workspace.snapshot(context)
    assert.equal(result.runtimeState, 'stopped')
    assert.equal(result.capabilities.invoke, false)
    assert.equal(calls(), 1)
  }))

test('browser projection labels loading and stale live observations without inventing a runtime failure', async () => {
  const { normalizeQuestWorkspace, questJobState, questSnapshotIsFresh } =
    await import('../../assets/js/lib/questWorkspace.mjs')
  const job = { name: 'job', paused: false, isRunning: false }
  const pending = normalizeQuestWorkspace({
    version: 1,
    mode: 'legacy',
    runtimeState: 'loading',
    jobs: [job]
  })
  assert.equal(questJobState(job, pending, false), 'loading')
  assert.equal(pending.capabilities.invoke, false)
  const stale = normalizeQuestWorkspace({
    version: 1,
    mode: 'resident',
    runtimeState: 'live',
    observedAt: Date.now() - 60000,
    target: { runtimeId: 'one' },
    jobs: [job]
  })
  assert.equal(questSnapshotIsFresh(stale), false)
  assert.equal(questJobState(job, stale, false), 'unknown')
})

test('warm pages reuse recent completed evidence without another container read and clamp viewer controls', () =>
  fixture(async ({ context, calls }) => {
    const live = await workspace.snapshot(context)
    const start = performance.now()
    const warm = await workspace.initialSnapshot(context)
    assert.equal(warm.target.runtimeId, live.target.runtimeId)
    assert.equal(warm.runtimeState, 'live')
    assert.equal(calls(), 1)
    assert.ok(performance.now() - start < 100)
    const member = await workspace.initialSnapshot({
      ...context,
      user: { teamRole: 'member' }
    })
    assert.equal(member.capabilities.invoke, false)
    context.app.currentDeployment = 'other'
    const changed = await workspace.initialSnapshot(context)
    assert.equal(changed.runtimeState, 'loading')
    assert.equal(changed.target.runtimeId, null)
    assert.equal(calls(), 1)
  }))

test('an invalid runtime reply is unknown, not proof that the runtime is unreachable', () =>
  fixture(async ({ context }) => {
    runtime.request = async () => ({
      version: 999,
      runtimeId: 'one',
      jobs: [],
      runs: []
    })
    const result = await workspace.snapshot(context, { fresh: true })
    assert.equal(result.runtimeState, 'unknown')
    assert.equal(result.capabilities.invoke, false)
    assert.equal(result.observedAt, null)
  }))

test('disabled Quest features cannot reuse a warm resident snapshot', () =>
  fixture(async ({ context, calls }) => {
    await workspace.snapshot(context)
    context.environment.features = {}
    const result = await workspace.initialSnapshot(context)
    assert.notEqual(result.runtimeState, 'live')
    assert.equal(result.capabilities.invoke, false)
    assert.equal(calls(), 1)
  }))
