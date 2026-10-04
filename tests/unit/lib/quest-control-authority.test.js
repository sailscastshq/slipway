const assert = require('node:assert/strict')
const fs = require('node:fs')
const vm = require('node:vm')
const { EventEmitter } = require('node:events')
const { PassThrough } = require('node:stream')
const { test } = require('sounding')
const runtime = require('../../../api/lib/quest-runtime-client')

function workspaceFixture() {
  const calls = [],
    observations = []
  let nextRead = null
  const retained = { runId: 'retained-run', state: 'completed', sequence: 2 }
  const context = {
    app: {
      id: 'app-1',
      currentDeployment: 'deployment-1',
      containerName: 'synthetic-never-executed',
      status: 'running'
    },
    environment: {
      id: 'environment-1',
      features: { 'sails-quest': { scripts: [] } }
    },
    user: { teamRole: 'owner' }
  }
  const module = { exports: {} }
  vm.runInNewContext(
    fs.readFileSync(
      require.resolve('../../../api/lib/quest-workspace'),
      'utf8'
    ),
    {
      module,
      require(name) {
        if (name === './quest-run-ledger')
          return {
            async listRuns() {
              return { runs: [retained], legacyEvents: [], nextCursor: null }
            },
            async reconcileUnavailableRuns(_scope, observation) {
              observations.push(observation)
              return { checked: 0, hasMore: false }
            },
            async reconcileRuntimeLoss() {
              return { checked: 0, hasMore: false }
            }
          }
        assert.equal(name, './quest-runtime-client')
        return {
          async request(app, command) {
            calls.push({ app, command })
            const observedAt = calls.length
            const blocked = nextRead
            nextRead = null
            if (blocked) await blocked
            return {
              version: 1,
              runtimeId: 'runtime-1',
              observedAt,
              jobs: [],
              runs: [],
              capabilities: { invoke: true, pause: true, resume: true }
            }
          }
        }
      }
    }
  )
  return {
    workspace: module.exports,
    context,
    calls,
    observations,
    retained,
    blockNextRead() {
      let release
      nextRead = new Promise((resolve) => {
        release = resolve
      })
      return release
    }
  }
}

function childFixture() {
  const calls = []
  return {
    calls,
    spawn(...args) {
      calls.push(args)
      const child = new EventEmitter()
      child.stdin = new PassThrough()
      child.stdout = new PassThrough()
      child.stderr = new PassThrough()
      child.stdin.on('finish', () => {
        child.stdout.write(
          JSON.stringify({ ok: true, data: { retained: true } })
        )
        child.emit('close', 0)
      })
      return child
    }
  }
}

// These tests execute only in-memory doubles, never Docker or Unix sockets.
test('Quest status changes invalidate cached control authority while retaining read-only history', async () => {
  const f = workspaceFixture()
  const first = await f.workspace.snapshot(f.context)
  assert.equal(first.capabilities.invoke, true)
  assert.equal((await f.workspace.snapshot(f.context)).observedAt, 1)
  assert.equal(f.calls.length, 1)
  for (const status of ['stopped', undefined]) {
    const context = { ...f.context, app: { ...f.context.app, status } }
    const blocked = await f.workspace.snapshot(context)
    for (const command of ['invoke', 'pause', 'resume'])
      assert.equal(blocked.capabilities[command], false, command)
    assert.equal(blocked.target.runtimeId, null)
    assert.equal(blocked.runs[0], f.retained)
    assert.equal(f.calls.length, 1)
    assert.equal(
      f.observations.at(-1).reason,
      status === 'stopped' ? 'app_stopped' : 'resident_unavailable'
    )
  }
  const recovered = await f.workspace.snapshot(f.context)
  assert.equal(recovered.capabilities.invoke, true)
  assert.equal(
    recovered.observedAt,
    2,
    'Reconnect requires new resident evidence'
  )
  assert.equal(f.calls.length, 2)
  f.workspace.invalidate(f.context.app)
  assert.equal((await f.workspace.snapshot(f.context)).observedAt, 3)
  assert.equal(f.calls.length, 3)
})

test('Quest mutation transport requires explicit running state before any process can start', async () => {
  const app = {
    id: 1,
    currentDeployment: 2,
    containerName: 'synthetic-never-executed'
  }
  const child = childFixture()
  for (const status of [
    'stopped',
    'failed',
    'starting',
    'building',
    'deploying',
    'unknown',
    undefined,
    null
  ])
    for (const command of ['invoke', 'pause', 'resume']) {
      await assert.rejects(
        runtime.request(
          { ...app, status },
          command,
          {},
          { spawn: child.spawn }
        ),
        { code: 'QUEST_TARGET_CHANGED' }
      )
      assert.equal(child.calls.length, 0, `${command} while ${status}`)
    }
})

test('Quest stopped authority bypasses an in-flight resident read and its late completion cannot revive the old cache', async () => {
  const f = workspaceFixture()
  const release = f.blockNextRead()
  const pending = f.workspace.snapshot(f.context)
  await new Promise((resolve) => setImmediate(resolve))
  const stopped = {
    ...f.context,
    app: { ...f.context.app, status: 'stopped' }
  }
  let blocked
  const unavailable = f.workspace.snapshot(stopped).then((value) => {
    blocked = value
  })
  try {
    await new Promise((resolve) => setImmediate(resolve))
    assert.equal(blocked?.capabilities.invoke, false)
    assert.equal(f.calls.length, 1)
  } finally {
    release()
    await Promise.all([pending, unavailable])
  }
  assert.equal((await f.workspace.snapshot(stopped)).capabilities.invoke, false)
  assert.equal(f.calls.length, 1)
  assert.equal((await f.workspace.snapshot(f.context)).observedAt, 2)
  assert.equal(f.calls.length, 2)
})

test('Quest cache stays scoped to the app and environment and invalidation clears every authority for only that app', async () => {
  const f = workspaceFixture()
  const otherApp = { ...f.context, app: { ...f.context.app, id: 'app-2' } }
  const otherEnvironment = {
    ...f.context,
    environment: { ...f.context.environment, id: 'environment-2' }
  }
  await f.workspace.snapshot(f.context)
  const retainedOther = await f.workspace.snapshot(otherApp)
  await f.workspace.snapshot(otherEnvironment)
  assert.equal(f.calls.length, 3)
  f.workspace.invalidate(f.context.app)
  assert.equal(await f.workspace.snapshot(otherApp), retainedOther)
  await f.workspace.snapshot(f.context)
  await f.workspace.snapshot(otherEnvironment)
  assert.equal(f.calls.length, 5)
  const stopped = { ...f.context, app: { ...f.context.app, status: 'stopped' } }
  await f.workspace.snapshot(stopped)
  const before = f.observations.length
  f.workspace.invalidate(f.context.app)
  await f.workspace.snapshot(stopped)
  assert.equal(f.observations.length, before + 1)
})

test('Quest transport still permits read-only evidence and running-state controls', async () => {
  const child = childFixture()
  const app = {
    id: 1,
    currentDeployment: 2,
    containerName: 'synthetic-never-executed'
  }
  for (const status of ['stopped', undefined])
    for (const command of ['snapshot', 'run'])
      assert.deepEqual(
        await runtime.request(
          { ...app, status },
          command,
          {},
          { spawn: child.spawn }
        ),
        { retained: true }
      )
  for (const command of ['invoke', 'pause', 'resume'])
    assert.deepEqual(
      await runtime.request(
        { ...app, status: 'running' },
        command,
        {},
        { spawn: child.spawn }
      ),
      { retained: true }
    )
  assert.equal(child.calls.length, 7)
})
