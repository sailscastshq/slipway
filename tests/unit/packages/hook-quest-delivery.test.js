const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const {
  createQuestDelivery,
  idFor
} = require('../../../packages/hook/lib/quest-delivery')
function fixture(t, send, now = Date.now) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'quest-delivery-'))
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }))
  const options = { directory, appId: '7', deploymentId: '42', send, now }
  return { options, directory, queue: createQuestDelivery(options) }
}
const run = (sequence = 1) => ({
  appId: '7',
  deploymentId: '42',
  runtimeId: 'old-runtime',
  runId: 'owned-run',
  jobName: 'fixture',
  requestedAt: Date.now(),
  sequence,
  state: sequence === 1 ? 'running' : 'completed',
  result: { status: 'available', value: false }
})
test('disk restart replays evidence without rerunning; only exact successful acknowledgements delete it', async (t) => {
  let response = {},
    calls = []
  const f = fixture(t, async (body) => {
    calls.push(body)
    return response
  })
  const event = run(2)
  assert.equal(f.queue.enqueue(event), true)
  assert.equal(f.queue.enqueue(event), true)
  assert.equal(f.queue.pending, 1)
  assert.equal(
    fs.statSync(path.join(f.directory, idFor(event) + '.json')).mode & 0o777,
    0o600
  )
  f.queue.stop()
  const restored = createQuestDelivery(f.options)
  await restored.flush()
  assert.equal(restored.pending, 1)
  response = { questAcknowledged: ['f'.repeat(64)] }
  await restored.flush()
  assert.equal(restored.pending, 1)
  response = { questAcknowledged: [idFor(event)] }
  await restored.flush()
  assert.equal(restored.pending, 0)
  assert.equal(calls.length, 3)
  assert.deepEqual(calls[0].questEvents[0].run.result.value, false)
})
test('restart removes only validated bounded incomplete receipts', (t) => {
  const f = fixture(t, async () => ({}))
  f.queue.stop()
  const event = run(2),
    id = idFor(event)
  fs.writeFileSync(
    path.join(f.directory, id + '.json.tmp'),
    JSON.stringify({ id, run: event }),
    { mode: 0o600 }
  )
  const restored = createQuestDelivery(f.options)
  assert.equal(restored.pending, 0)
  assert.equal(fs.readdirSync(f.directory).length, 0)
  assert.equal(restored.enqueue(event), true)
  restored.stop()
  fs.writeFileSync(
    path.join(f.directory, id + '.json.tmp'),
    JSON.stringify({ id, run: { ...event, deploymentId: 'foreign' } }),
    { mode: 0o600 }
  )
  assert.throws(() => createQuestDelivery(f.options), /identity/)
  assert.equal(fs.existsSync(path.join(f.directory, id + '.json.tmp')), true)
})
test('outage, concurrent flushes, count pressure and expiry stay bounded', async (t) => {
  let resolve,
    calls = 0,
    clock = Date.now()
  const f = fixture(
    t,
    () => {
      calls++
      return new Promise((r) => {
        resolve = r
      })
    },
    () => clock
  )
  for (let sequence = 1; sequence <= 256; sequence++)
    assert.equal(f.queue.enqueue(run(sequence)), true)
  assert.equal(f.queue.enqueue(run(257)), false)
  const first = f.queue.flush()
  await f.queue.flush()
  assert.equal(calls, 1)
  resolve({})
  await first
  assert.equal(f.queue.pending, 256)
  clock += 8 * 86400000
  await f.queue.flush()
  assert.equal(f.queue.pending, 0)
})
test('foreign deployment, writable directory, tampered and symlink receipts fail closed', (t) => {
  const f = fixture(t, async () => ({}))
  assert.equal(f.queue.enqueue({ ...run(), deploymentId: '43' }), false)
  fs.chmodSync(f.directory, 0o755)
  assert.throws(() => createQuestDelivery(f.options), /private/)
  fs.chmodSync(f.directory, 0o700)
  const name = path.join(f.directory, 'a'.repeat(64) + '.json')
  fs.symlinkSync('/etc/passwd', name)
  assert.throws(() => createQuestDelivery(f.options), /unsafe/)
})

test('live replay is bounded, redacts split chunks and never changes terminal truth', async () => {
  const {
    createQuestRuntime
  } = require('../../../packages/hook/lib/quest-runtime')
  const { EventEmitter } = require('node:events')
  const sails = new EventEmitter()
  const runtimeId = 'live-runtime'
  sails.quest = {
    getRuntime: () => ({
      contractVersion: 1,
      runtimeId,
      capabilities: {
        residentState: true,
        runIdentity: true,
        childSchedulerSuppression: true,
        liveLogs: true
      }
    }),
    metadata: () => ({
      inputs: { secret: { type: 'string', sensitive: true } }
    })
  }
  const bridge = createQuestRuntime({ sails, appId: '7', deploymentId: '42' })
  const data = {
    name: 'synthetic',
    runId: 'live-run',
    runtimeId,
    sequence: 1,
    timestamp: Date.now(),
    inputs: { secret: 'split-sensitive' }
  }
  bridge.record('running', data)
  bridge.record('log', {
    ...data,
    sequence: 2,
    logs: { stdout: 'hello\nsplit-sensi', stderr: '' }
  })
  const read = (afterSequence) =>
    bridge.dispatch({
      command: 'logs',
      appId: '7',
      deploymentId: '42',
      runtimeId,
      runId: data.runId,
      afterSequence
    })
  assert.equal((await read(0)).stdout, 'hello\n')
  bridge.record('log', {
    ...data,
    sequence: 3,
    logs: { stdout: 'hello\nsplit-sensitive\n', stderr: 'successful warning\n' }
  })
  assert.equal(
    (await read(2)).entries[0].stdout.includes('split-sensitive'),
    false
  )
  for (let sequence = 4; sequence < 35; sequence++)
    bridge.record('log', {
      ...data,
      sequence,
      logs: { stdout: `line ${sequence}\n`, stderr: '' }
    })
  const replay = await read(2)
  assert.equal(replay.gap, true)
  assert.ok(replay.entries.length <= 16)
  bridge.record('completed', {
    ...data,
    sequence: 35,
    exitCode: 0,
    result: { status: 'available', value: false }
  })
  bridge.record('log', { ...data, sequence: 36, logs: { stdout: 'late\n' } })
  assert.equal((await read(34)).state, 'completed')
  assert.equal(bridge.runs.get(data.runId).result.value, false)
})
