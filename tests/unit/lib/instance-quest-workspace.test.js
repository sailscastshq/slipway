const assert = require('node:assert/strict')
const { randomUUID } = require('node:crypto')
const { test } = require('sounding')
const adapter = require('../../../api/lib/instance-quest-workspace')
const run = (extra = {}) => ({
  id: randomUUID(),
  name: 'maintain-wake',
  state: 'running',
  trigger: 'scheduled',
  startedAt: '2026-10-20T12:00:00.000Z',
  logs: { stdout: 'retained output', stderr: '' },
  ...extra
})
test('Instance workspace uses shared metadata presentation without inventing remote identities or controls', () => {
  const snapshot = {
    available: true,
    jobs: [
      {
        name: 'maintain-wake',
        schedule: { interval: '5 minutes', timezone: 'UTC' },
        nextRunAt: '2026-10-20T12:05:00.000Z',
        runningCount: 1,
        paused: false,
        scheduled: true,
        withoutOverlapping: true,
        manualAllowed: false
      }
    ],
    runs: [run()]
  }
  const value = adapter.normalize(snapshot, [
    {
      name: 'maintain-wake',
      inputMetadataAvailable: true,
      inputs: {
        preview: { type: 'boolean', defaultsTo: false },
        password: { type: 'string', defaultsTo: 'never expose' }
      }
    }
  ])
  assert.equal(value.mode, 'resident')
  assert.equal(value.scope, 'instance')
  assert.deepEqual(value.target, {})
  assert.deepEqual(value.capabilities, {
    invoke: false,
    pause: false,
    resume: false,
    cancel: false,
    liveLogs: false,
    results: true,
    typedInputs: false
  })
  assert.equal(value.jobs[0].schedule, '5 minutes')
  assert.equal(value.jobs[0].scheduleType, 'interval')
  assert.equal(value.jobs[0].timezone, 'UTC')
  assert.equal(value.jobs[0].nextRunAt, Date.parse(snapshot.jobs[0].nextRunAt))
  assert.equal(value.jobs[0].isRunning, true)
  assert.equal(value.jobs[0].paused, false)
  assert.equal(value.jobs[0].withoutOverlapping, true)
  assert.equal(value.jobs[0].executionScope, 'instance')
  assert.equal(value.jobs[0].inputs[0].defaultsTo, false)
  assert.equal(value.jobs[0].inputs[1].sensitive, true)
  assert.equal(Object.hasOwn(value.jobs[0].inputs[1], 'defaultsTo'), false)
  assert.equal(value.nextCursor, null)
  assert.deepEqual(value.legacyEvents, [])
  assert.equal(value.historyScope, 'Last 100 retained instance runs')
  assert.equal(adapter.normalize({ available: false }).mode, 'unavailable')
  assert.equal(
    adapter.normalize(snapshot).jobs[0].inputMetadataAvailable,
    false
  )
})
test('Instance retained runs expose truthful uncertainty, parsed results and content revisions', () => {
  const source = run({
    state: 'interrupted',
    finishedAt: '2026-10-20T12:01:00.000Z',
    result: '{malformed',
    updatedAt: 1792497600001
  })
  const value = adapter.normalizeRun(source)
  assert.equal(value.runId, source.id)
  assert.equal(value.jobName, source.name)
  assert.equal(value.startedAt, Date.parse(source.startedAt))
  assert.equal(value.updatedAt, source.updatedAt)
  assert.equal(value.state, 'unconfirmed')
  assert.equal(value.finishedAt, null)
  assert.equal(value.duration, null)
  assert.match(value.error, /completion is unknown/)
  assert.deepEqual(value.result, { status: 'serialization_error' })
  assert.equal(
    adapter.normalizeRun({ ...source, logs: { stdout: 'changed' } })
      .revision === value.revision,
    false
  )
  assert.equal(adapter.normalizeRun(source).revision, value.revision)
  const requested = adapter.normalizeRun(run({ state: 'requested' }))
  assert.equal(requested.state, 'requested')
  assert.equal(requested.startedAt, null)
  assert.equal(requested.requestedAt, Date.parse(source.startedAt))
  assert.deepEqual(
    adapter.normalizeRun(
      run({ result: JSON.stringify({ status: 'available', value: false }) })
    ).result,
    { status: 'available', value: false }
  )
  assert.deepEqual(
    adapter.normalizeRun(
      run({ result: JSON.stringify({ status: 'available' }) })
    ).result,
    { status: 'serialization_error' }
  )
})
test('Instance retained logs stay bounded at valid UTF-8 boundaries and preserve actual sequence', () => {
  const source = run({
    sequence: 23,
    logs: { stdout: '🌊'.repeat(20000), stderr: 'warning' }
  })
  const logs = adapter.logs(source)
  assert.equal(logs.runId, source.id)
  assert.equal(logs.sequence, 23)
  assert.equal(logs.state, 'running')
  assert.equal(logs.available, true)
  assert.equal(logs.truncated, true)
  assert.ok(Buffer.byteLength(logs.stdout) <= 32768)
  assert.equal(logs.stdout.includes('\uFFFD'), false)
  assert.equal(logs.stderr, 'warning')
  assert.equal(adapter.logs(run({ logs: undefined })).available, false)
})
