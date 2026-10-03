const assert = require('node:assert/strict')
const { randomUUID } = require('node:crypto')
const workspace = require('../../../api/lib/quest-workspace')

const executionFields = (run) =>
  Object.fromEntries(
    [
      'sequence',
      'requestedAt',
      'startedAt',
      'finishedAt',
      'exitCode',
      'result'
    ].map((name) => [name, run[name]])
  )

async function recoveryTrials({
  sails,
  app,
  fixture,
  client,
  base,
  invoke,
  call,
  refresh,
  snapshot,
  evidence,
  waitForRun,
  readPersisted
}) {
  const setTarget = async (values) => {
    const updated = await sails.models.app.updateOne({ id: app.id }).set(values)
    Object.assign(app, updated)
    workspace.invalidate(app)
  }
  const row = (runId) => sails.models.questrun.findOne({ runId })
  // Exercise actual target unavailability without killing work. Only the test's
  // disposable App record changes; resident transport is never replaced/stubbed.
  const active = await invoke('slow-job', {
    label: 'recoverable-outage',
    delayMs: 14000
  })
  const original = await row(active.run.runId)
  assert.equal(original.state, 'running')
  const originalFields = executionFields(original)
  await setTarget({ status: 'stopped' })
  await readPersisted(active.run.runId, 'unconfirmed')
  assert.match((await row(active.run.runId)).error, /app is stopped/)
  assert.deepEqual(executionFields(await row(active.run.runId)), originalFields)
  // A verified same-sequence resident read may restore Running. No re-invocation.
  await setTarget({ status: 'running' })
  await readPersisted(active.run.runId, 'running')
  assert.equal((await row(active.run.runId)).error, null)
  assert.deepEqual(executionFields(await row(active.run.runId)), originalFields)
  const actualContainer = app.containerName
  try {
    await setTarget({
      containerName: `slipway-quest-unreachable-${randomUUID()}`
    })
    await readPersisted(active.run.runId, 'unconfirmed')
    assert.match((await row(active.run.runId)).error, /could not be read/)
    assert.deepEqual(
      executionFields(await row(active.run.runId)),
      originalFields
    )
  } finally {
    await setTarget({ containerName: actualContainer })
  }
  await readPersisted(active.run.runId, 'running')
  assert.equal((await row(active.run.runId)).error, null)
  assert.deepEqual(executionFields(await row(active.run.runId)), originalFields)
  assert.equal((await waitForRun(active.run.runId)).state, 'completed')
  await readPersisted(active.run.runId, 'completed')
  assert.equal(
    (await evidence()).filter(
      (event) =>
        event.kind === 'business:start' &&
        event.inputs?.label === 'recoverable-outage'
    ).length,
    1
  )

  // Deliberately withhold reconciliation after a real completion, then evict
  // its resident receipt using 40 real paused timer skips. No invented events,
  // model-seeded executions, additional business children or runtime restart.
  const lost = await invoke('slow-job', {
    label: 'same-runtime-retention-loss',
    delayMs: 1500
  })
  const pending = await row(lost.run.runId)
  assert.equal(pending.state, 'running')
  const pendingFields = executionFields(pending)
  assert.equal((await waitForRun(lost.run.runId)).state, 'completed')
  const before = await snapshot()
  assert.equal(
    (await row(lost.run.runId)).state,
    'running',
    'Terminal delivery is intentionally withheld'
  )
  await fixture.inspect('pressure')
  await fixture.waitFor(
    evidence,
    (items) =>
      items.some(
        (event) => event.kind === 'pressure:complete' && event.skips === 40
      ),
    'bounded real timer retention pressure'
  )
  const after = await snapshot()
  assert.equal(after.runtimeId, before.runtimeId)
  assert.equal(
    after.runs.some((run) => run.runId === lost.run.runId),
    false
  )
  await assert.rejects(call('run', { runId: lost.run.runId }), {
    code: 'QUEST_RUN_UNAVAILABLE'
  })
  const pressure = after.jobs.find((job) => job.name === 'retention-pressure')
  assert.equal(
    pressure.inputMetadataAvailable,
    false,
    'A dynamic empty schema must fail closed'
  )
  assert.equal(
    pressure.scheduled,
    false,
    'Pressure timer is stopped after its bounded burst'
  )
  assert.equal(
    (
      await client.post(`${base}/jobs/retention-pressure/run`, {
        runtimeId: after.runtimeId,
        metadataVersion: pressure.metadataVersion,
        requestId: randomUUID(),
        productionConfirmed: true,
        jobInputs: {}
      })
    ).status,
    400
  )
  await readPersisted(lost.run.runId, 'unconfirmed')
  assert.match((await row(lost.run.runId)).error, /no longer retains evidence/)
  assert.deepEqual(executionFields(await row(lost.run.runId)), pendingFields)
  const skips = after.runs.filter((run) => run.jobName === 'retention-pressure')
  assert.ok(skips.length > 0)
  for (const skip of skips) {
    assert.equal(skip.state, 'skipped')
    assert.equal(skip.trigger, 'scheduled')
    assert.equal(skip.startedAt, null)
    assert.equal(skip.exitCode, null)
    assert.equal(skip.resultStatus, 'unavailable')
  }
  await refresh()
  assert.equal((await row(lost.run.runId)).state, 'unconfirmed')
  const final = await evidence()
  assert.equal(
    final.filter(
      (event) =>
        event.kind === 'business:start' &&
        event.inputs?.label === 'same-runtime-retention-loss'
    ).length,
    1
  )
  assert.equal(
    final.filter(
      (event) =>
        event.kind === 'quest:start' && event.name === 'retention-pressure'
    ).length,
    0
  )
  return {
    recoveredRunId: active.run.runId,
    sameRuntimeLostRunId: lost.run.runId,
    retentionPressureSkips: 40
  }
}
module.exports = { recoveryTrials }
