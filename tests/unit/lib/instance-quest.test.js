const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs/promises')
const os = require('node:os')
const path = require('node:path')
const { EventEmitter } = require('node:events')
const { randomUUID } = require('node:crypto')
const { create } = require('../../../api/lib/instance-quest')
const { createRedactor } =
  require('../../../api/helpers/security/redact')._private

async function fixture(t) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'instance-quest-test-'))
  const sails = new EventEmitter()
  const redactor = createRedactor()
  redactor.remember({ password: 'fixture-secret-12345' })
  Object.assign(sails, {
    config: { appPath: root, quest: { runtimeControls: true } },
    hooks: { secrets: { text: redactor.text, protect: redactor.protect } },
    log: { error() {} }
  })
  const job = {
    name: 'maintain-wake',
    withoutOverlapping: true,
    runningCount: 0,
    scheduled: true,
    schedule: { interval: '5 minutes', timezone: 'UTC' },
    nextRunAt: '2026-10-20T12:05:00.000Z'
  }
  let calls = 0,
    finish
  let nativeId
  const inputsSent = []
  sails.quest = {
    get: (name) => (name === job.name ? job : null),
    metadata: (name) =>
      name ? (name === job.name ? job : null) : [job, { name: 'unlisted' }],
    run: (name, inputs) => {
      inputsSent.push(structuredClone(inputs))
      calls++
      job.runningCount++
      nativeId = randomUUID()
      sails.emit('quest:job:start', {
        name,
        runId: nativeId,
        trigger: 'manual',
        startedAt: new Date()
      })
      return new Promise((resolve) => {
        finish = () => {
          job.runningCount--
          sails.emit('quest:job:complete', {
            name,
            runId: nativeId,
            trigger: 'manual',
            startedAt: new Date(),
            logs: { stdout: 'done', stderr: '' },
            result: {
              status: 'available',
              value: { password: 'fixture-secret-12345' }
            }
          })
          resolve([])
        }
      })
    }
  }
  const adapter = create(sails)
  await adapter.initialize()
  t.after(async () => {
    finish?.()
    await adapter.close()
    await fs.rm(root, { recursive: true, force: true })
  })
  return {
    root,
    sails,
    adapter,
    job,
    calls: () => calls,
    finish: () => finish(),
    inputsSent,
    native: () => nativeId
  }
}
test('allowlist, input validation, runtime metadata and idempotent manual admission', async (t) => {
  const { adapter, calls, job, finish } = await fixture(t)
  assert.deepEqual(
    (await adapter.snapshot()).jobs.map((j) => j.name),
    ['maintain-wake']
  )
  await assert.rejects(adapter.trigger('../evil', randomUUID()), {
    status: 400
  })
  await assert.rejects(adapter.trigger('maintain-wake', '../request'), {
    status: 400
  })
  await assert.rejects(
    adapter.trigger('maintain-wake', randomUUID(), { remove: true }),
    { status: 400 }
  )
  const requestId = randomUUID()
  const first = await adapter.trigger(job.name, requestId)
  assert.equal(first.run.state, 'running')
  assert.equal((await adapter.trigger(job.name, requestId)).duplicate, true)
  await assert.rejects(adapter.trigger(job.name, randomUUID()), { status: 409 })
  assert.equal(calls(), 1)
  finish()
  const snapshot = await adapter.snapshot()
  assert.equal(snapshot.runs[0].state, 'completed')
  assert.doesNotMatch(JSON.stringify(snapshot), /fixture-secret-12345/)
})
test('simultaneous requests admit one invocation and retain redacted bounded live output', async (t) => {
  const { adapter, sails, calls, native } = await fixture(t)
  const results = await Promise.allSettled([
    adapter.trigger('maintain-wake', randomUUID()),
    adapter.trigger('maintain-wake', randomUUID())
  ])
  assert.equal(results.filter((r) => r.status === 'fulfilled').length, 1)
  assert.equal(calls(), 1)
  sails.emit('quest:job:log', {
    name: 'maintain-wake',
    runId: native(),
    trigger: 'manual',
    logs: { stdout: 'x'.repeat(50000) + ' fixture-secret-12345', stderr: '' }
  })
  const run = (await adapter.snapshot()).runs[0]
  assert.equal(run.state, 'running')
  assert.equal(run.logs.truncated, true)
  assert.ok(Buffer.byteLength(run.logs.stdout) <= 32768)
  assert.doesNotMatch(JSON.stringify(run), /fixture-secret-12345/)
})
test('restart retains history and marks unfinished work interrupted without replay', async (t) => {
  const { adapter, sails, root, calls } = await fixture(t)
  const id = randomUUID()
  await adapter.trigger('maintain-wake', id)
  await adapter.close()
  const recovered = create(sails)
  await recovered.initialize()
  t.after(() => recovered.close())
  const run = (await recovered.snapshot()).runs[0]
  assert.equal(run.state, 'interrupted')
  assert.equal((await recovered.trigger('maintain-wake', id)).duplicate, true)
  assert.equal(calls(), 1)
  const retained = JSON.parse(
    await fs.readFile(
      path.join(root, 'db', 'instance-quest', `${id}.json`),
      'utf8'
    )
  )
  assert.equal(retained.state, 'interrupted')
})
test('scheduled runs share the adapter; unknown events are ignored and the history is bounded', async (t) => {
  const { adapter, sails } = await fixture(t)
  for (let n = 0; n < 110; n++) {
    sails.emit('quest:job:complete', {
      name: 'maintain-wake',
      runId: randomUUID(),
      trigger: 'scheduled',
      startedAt: new Date(Date.now() + n),
      logs: { stdout: 'safe fixture', stderr: '' }
    })
  }
  sails.emit('quest:job:start', { name: 'unlisted', runId: randomUUID() })
  const snapshot = await adapter.snapshot()
  assert.equal(snapshot.runs.length, 100)
  assert.equal(snapshot.error, null)
  const files = await fs.readdir(
    path.join(sails.config.appPath, 'db', 'instance-quest')
  )
  assert.equal(files.filter((name) => name.endsWith('.json')).length, 100)
  assert.ok(snapshot.runs.every((run) => run.trigger === 'scheduled'))
})
test('a persistence failure disables further manual admission', async (t) => {
  const { root, adapter, sails } = await fixture(t)
  await fs.rm(path.join(root, 'db', 'instance-quest'), { recursive: true })
  sails.emit('quest:job:complete', {
    name: 'maintain-wake',
    runId: randomUUID(),
    trigger: 'scheduled'
  })
  assert.match((await adapter.snapshot()).error, /could not be persisted/)
  await assert.rejects(adapter.trigger('maintain-wake', randomUUID()), {
    status: 503
  })
})

test('a torn history record disables instance controls without preventing Slipway startup', async (t) => {
  const { root, adapter, sails } = await fixture(t)
  await adapter.close()
  const file = path.join(root, 'db', 'instance-quest', `${randomUUID()}.json`)
  await fs.writeFile(file, '{"id":', { mode: 0o600 })
  const hook = require('../../../api/hooks/instance-quest')(sails)
  await hook.initialize()
  const snapshot = await sails.instanceQuest.snapshot()
  assert.equal(snapshot.available, false)
  assert.match(snapshot.error, /Manual runs are disabled/)
  await assert.rejects(
    sails.instanceQuest.trigger('maintain-wake', randomUUID()),
    { status: 503 }
  )
  assert.equal(await fs.readFile(file, 'utf8'), '{"id":')
  assert.equal(sails.listenerCount('quest:job:start'), 0)
})

test('cleanup accepts only an explicit boolean preview and keeps request identity tied to its mode', async (t) => {
  const { adapter, job, finish, inputsSent, sails } = await fixture(t)
  job.name = 'retain-deployment-images'
  assert.equal((await adapter.snapshot()).jobs[0].cleanupEnabled, true)
  for (const input of [
    { remove: true },
    { preview: 'true' },
    { preview: true, other: 1 }
  ])
    await assert.rejects(adapter.trigger(job.name, randomUUID(), input), {
      status: 400
    })
  const requestId = randomUUID()
  await adapter.trigger(job.name, requestId, { preview: true })
  assert.deepEqual(inputsSent[0], { preview: true })
  finish()
  await assert.rejects(adapter.trigger(job.name, requestId), { status: 409 })
  await adapter.trigger(job.name, randomUUID())
  assert.deepEqual(inputsSent[1], {})
  finish()
  sails.config.imageRetention = { remove: false }
  assert.equal((await adapter.snapshot()).jobs[0].cleanupEnabled, false)
})
