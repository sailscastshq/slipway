const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const net = require('node:net')
const { EventEmitter } = require('node:events')
const { test } = require('sounding')
const {
  createQuestRuntime,
  describeJob,
  validateInputs,
  safeValue
} = require('../../../packages/hook/lib/quest-runtime')
const questEvent = require('../../../packages/hook/lib/quest-event')

// This fixture tests the resident adapter contract. It is deliberately NOT
// proof of upstream scheduler behavior; no Sails app, job or child is lifted.
function fixture(overrides = {}) {
  const sails = new EventEmitter()
  const calls = []
  const source = {
    name: 'reports/daily',
    script: 'scripts/reports/daily.js',
    inputMetadataAvailable: true,
    inputs: {
      enabled: { type: 'boolean', defaultsTo: true },
      count: { type: 'number', min: 0, max: 10 },
      label: { type: 'string', maxLength: 20 },
      payload: { type: 'json' },
      opaque: { type: 'string', sensitive: true },
      apiToken: { type: 'string', defaultsTo: 'never-publish' }
    },
    schedule: { interval: 60000 },
    paused: false,
    runningCount: 0,
    withoutOverlapping: true,
    ...overrides
  }
  const info = {
    contractVersion: 1,
    runtimeId: 'runtime-fixture',
    capabilities: {
      residentState: true,
      childSchedulerSuppression: true,
      runIdentity: true,
      inputMetadata: true,
      businessResults: true
    }
  }
  sails.quest = {
    getRuntime: () => info,
    metadata: (name) => (name ? source : [source]),
    pause: (name) => {
      calls.push(['pause', name])
      source.paused = true
    },
    resume: (name) => {
      calls.push(['resume', name])
      source.paused = false
    }
  }
  const bridge = createQuestRuntime({ sails, appId: '12', deploymentId: '34' })
  // Equivalent to the subscription installed by start(), without real sockets.
  for (const [event, state] of [
    ['start', 'running'],
    ['complete', 'completed'],
    ['error', 'failed'],
    ['skip', 'skipped']
  ])
    sails.on(`quest:job:${event}`, (data) => bridge.record(state, data))
  let complete
  sails.quest.run = (name, inputs) => {
    calls.push(['run', name, inputs])
    sails.emit('quest:job:start', {
      name,
      inputs,
      runId: `canonical-${calls.filter(([kind]) => kind === 'run').length}`,
      runtimeId: info.runtimeId,
      sequence: 1,
      startedAt: 1000
    })
    return new Promise((resolve) => {
      complete = resolve
    })
  }
  const message = (extra = {}) => ({
    command: 'invoke',
    appId: '12',
    deploymentId: '34',
    runtimeId: info.runtimeId,
    name: source.name,
    metadataVersion: describeJob(source).metadataVersion,
    requestId: 'request-fixture-0001',
    actor: 'Test operator',
    jobInputs: {},
    ...extra
  })
  return {
    sails,
    source,
    info,
    calls,
    bridge,
    message,
    complete: (...args) => complete?.(...args)
  }
}

const rejectsCode = (promise, code) => assert.rejects(promise, { code })

test('Quest metadata preserves typed falsy defaults and excludes secret defaults', () => {
  const job = describeJob({
    name: 'synthetic',
    inputs: {
      enabled: { type: 'boolean', defaultsTo: false },
      count: { type: 'number', defaultsTo: 0 },
      text: { type: 'string', defaultsTo: '' },
      payload: { type: 'json', defaultsTo: { empty: [], flag: false } },
      opaque: { type: 'string', protect: true, defaultsTo: 'private' }
    },
    schedule: { cron: '0 * * * *', timezone: 'UTC' }
  })
  assert.deepEqual(
    job.inputs.slice(0, 4).map((field) => field.defaultsTo),
    [false, 0, '', { empty: [], flag: false }]
  )
  const declared = describeJob({
    name: 'declared',
    inputs: {
      opaque: { type: 'string', secret: true, defaultsTo: 'do-not-copy' }
    }
  })
  assert.equal(declared.inputs[0].sensitive, true)
  assert.equal(Object.hasOwn(declared.inputs[0], 'defaultsTo'), false)
  assert.equal(job.inputs[4].sensitive, true)
  assert.equal(Object.hasOwn(job.inputs[4], 'defaultsTo'), false)
  assert.equal(job.timezone, 'UTC')
  assert.equal(safeValue('token=abc'), 'token=<redacted>')
  assert.equal(safeValue('Bearer abc'), 'Bearer <redacted>')
  assert.deepEqual(safeValue({ value: '  first\nsecond  \n' }), {
    value: '  first\nsecond  \n'
  })
  const values = { enabled: false, count: 0, text: '', payload: null }
  assert.deepEqual(validateInputs(job, values), values)
})

test('Quest scheduled metadata preserves effective values and provenance without exposing secrets or claiming validation', () => {
  const source = {
    name: 'source-report',
    inputs: {
      count: { type: 'number', defaultsTo: 7 },
      enabled: { type: 'boolean' },
      payload: { type: 'json' },
      requiredValue: { type: 'string', required: true },
      opaque: { type: 'string', required: true, sensitive: true }
    },
    schedule: { interval: 1000 },
    scheduled: false,
    scheduledInputs: {
      validation: 'not_checked',
      limitBytes: 65536,
      values: {
        count: 0,
        enabled: false,
        payload: null,
        opaque: 'never-export'
      },
      fields: {
        count: {
          source: 'script_input',
          sensitive: false,
          available: true,
          missingRequired: false
        },
        enabled: {
          source: 'job_input',
          sensitive: false,
          available: true,
          missingRequired: false
        },
        payload: {
          source: 'schema_default',
          sensitive: false,
          available: true,
          missingRequired: false
        },
        requiredValue: {
          source: 'omitted',
          sensitive: false,
          available: false,
          missingRequired: true
        },
        opaque: {
          source: 'job_input',
          sensitive: false,
          available: true,
          missingRequired: false
        }
      }
    }
  }
  const described = describeJob(source)
  assert.deepEqual(described.scheduledInputs.values, {
    count: 0,
    enabled: false,
    payload: null
  })
  assert.equal(described.inputs[0].defaultsTo, 7)
  assert.equal(described.scheduled, false)
  assert.equal(described.scheduledInputs.validation, 'not_checked')
  assert.equal(described.scheduledInputs.fields.count.source, 'script_input')
  assert.equal(
    described.scheduledInputs.fields.requiredValue.missingRequired,
    true
  )
  assert.deepEqual(described.scheduledInputs.fields.opaque, {
    source: 'job_input',
    sensitive: true,
    available: false,
    missingRequired: false,
    reason: 'sensitive'
  })
  assert.equal(JSON.stringify(described).includes('never-export'), false)
  source.scheduledInputs.values.count = 1
  assert.notEqual(
    describeJob(source).metadataVersion,
    described.metadataVersion
  )
  assert.equal(
    describeJob({ ...source, scheduledInputs: undefined }).scheduledInputs,
    null
  )
  assert.equal(
    describeJob({ ...source, scheduledInputs: { values: {}, fields: {} } })
      .scheduledInputs,
    null
  )
})

test('Quest does not hide required undefined source values or reject an explicitly nullable enum', () => {
  for (const source of ['job_input', 'script_input']) {
    const job = describeJob({
      name: 'required-source',
      inputs: { value: { type: 'string', required: true } },
      scheduledInputs: {
        validation: 'not_checked',
        values: {},
        fields: {
          value: {
            source,
            available: false,
            missingRequired: true,
            reason: 'serialization_error'
          }
        }
      }
    })
    assert.equal(job.scheduledInputs.fields.value.missingRequired, true)
  }
  const nullable = describeJob({
    name: 'nullable',
    inputs: { value: { type: 'string', allowNull: true, isIn: ['a', 'b'] } }
  })
  assert.deepEqual(validateInputs(nullable, { value: null }), { value: null })
  const integer = describeJob({
    name: 'integer',
    inputs: { value: { type: 'number', isInteger: true } }
  })
  assert.throws(() => validateInputs(integer, { value: 1.5 }), {
    code: 'QUEST_INPUT_INVALID'
  })
})

test('Quest cannot invoke registered jobs without a loaded input schema', async () => {
  for (const inputMetadataAvailable of [false, undefined]) {
    const f = fixture({ inputMetadataAvailable })
    await rejectsCode(f.bridge.dispatch(f.message()), 'QUEST_UNAVAILABLE')
    assert.equal(f.calls.length, 0)
    const snapshot = await f.bridge.dispatch(f.message({ command: 'snapshot' }))
    assert.equal(snapshot.jobs[0].inputMetadataAvailable, false)
  }
  const f = fixture({ inputs: {} })
  assert.equal((await f.bridge.dispatch(f.message())).run.state, 'running')
})

test('Quest bounds and sanitizes scheduled metadata without turning unavailable values into defaults', () => {
  const job = describeJob({
    name: 'bounded',
    inputs: {
      large: { type: 'string' },
      first: { type: 'string' },
      second: { type: 'string' },
      nested: { type: 'json' }
    },
    scheduledInputs: {
      validation: 'not_checked',
      values: {
        large: 'x'.repeat(17 * 1024),
        first: 'a'.repeat(10000),
        second: 'b'.repeat(10000),
        nested: { apiToken: 'private' }
      },
      fields: Object.fromEntries(
        ['large', 'first', 'second', 'nested'].map((name) => [
          name,
          { source: 'job_input', available: true }
        ])
      )
    }
  })
  assert.equal(job.scheduledInputs.limitBytes, 16 * 1024)
  assert.equal(job.scheduledInputs.fields.large.reason, 'too_large')
  assert.equal(job.scheduledInputs.fields.second.reason, 'metadata_limit')
  assert.equal(job.scheduledInputs.fields.first.available, true)
  assert.deepEqual(job.scheduledInputs.values.nested, {
    apiToken: '<redacted>'
  })
  assert.ok(
    Buffer.byteLength(JSON.stringify(job.scheduledInputs.values)) <= 16 * 1024
  )
})

test('Quest validates types, numeric/string bounds, field names, and bounded plain JSON before admission', async () => {
  const f = fixture()
  let nested = 1
  for (let depth = 0; depth < 10; depth++) nested = { nested }
  const cyclic = {}
  cyclic.self = cyclic
  const invalid = [
    false,
    0,
    null,
    '',
    [],
    'not-an-object',
    { enabled: 'false' },
    { count: -1 },
    { count: 11 },
    { count: NaN },
    { count: Infinity },
    { label: 'x'.repeat(21) },
    { unknown: true },
    JSON.parse('{"__proto__":{}}'),
    { constructor: {} },
    { prototype: {} },
    { payload: 'x'.repeat(16 * 1024) },
    { payload: nested },
    { payload: cyclic },
    { payload: new Date() },
    { payload: undefined },
    { payload: () => 1 },
    { payload: 1n }
  ]
  for (const jobInputs of invalid)
    await rejectsCode(
      f.bridge.dispatch(f.message({ jobInputs })),
      'QUEST_INPUT_INVALID'
    )
  assert.equal(f.calls.length, 0)
  assert.throws(() => safeValue(cyclic), { code: 'QUEST_INPUT_INVALID' })
})

test('Quest stale identities, metadata, unsafe paths, and unknown jobs cannot start a job', async () => {
  const f = fixture()
  for (const extra of [
    { appId: '13' },
    { deploymentId: '35' },
    { runtimeId: 'old-runtime' },
    { runtimeId: undefined },
    { metadataVersion: 'stale-schema' }
  ])
    await rejectsCode(
      f.bridge.dispatch(f.message(extra)),
      'QUEST_TARGET_CHANGED'
    )
  for (const name of [
    '../daily',
    '/reports/daily',
    'daily;touch /tmp/no',
    'unknown'
  ])
    await rejectsCode(
      f.bridge.dispatch(f.message({ name })),
      'QUEST_INPUT_INVALID'
    )
  await rejectsCode(
    f.bridge.dispatch(f.message({ requestId: 'short' })),
    'QUEST_INPUT_INVALID'
  )
  assert.equal(f.calls.length, 0)
  for (const version of [0, 2, undefined]) {
    f.info.contractVersion = version
    await rejectsCode(
      f.bridge.dispatch(f.message({ command: 'snapshot' })),
      'QUEST_UNAVAILABLE'
    )
  }
  f.info.contractVersion = 1
  for (const suppressed of [false, undefined]) {
    f.info.capabilities.childSchedulerSuppression = suppressed
    await rejectsCode(f.bridge.dispatch(f.message()), 'QUEST_UNAVAILABLE')
  }
  f.info.capabilities.childSchedulerSuppression = true
  f.info.capabilities.runIdentity = false
  await rejectsCode(f.bridge.dispatch(f.message()), 'QUEST_UNAVAILABLE')
  assert.equal(f.calls.length, 0)
})

test('Quest captures synchronous canonical start before the execution Promise settles and deduplicates concurrent requests', async () => {
  const f = fixture()
  const jobInputs = {
    enabled: false,
    count: 0,
    label: '',
    payload: { list: [null, false, 0, ''] },
    opaque: 'keep-out',
    apiToken: 'secret'
  }
  const message = f.message({ jobInputs })
  const [first, second] = await Promise.all([
    f.bridge.dispatch(message),
    f.bridge.dispatch(message)
  ])
  assert.deepEqual(first, second)
  assert.equal(first.run.runId, 'canonical-1')
  assert.equal(first.run.state, 'running')
  assert.equal(first.run.requestId, message.requestId)
  assert.equal(first.run.actor, 'Test operator')
  assert.equal(first.run.trigger, 'manual')
  assert.equal(first.run.resultStatus, 'unavailable')
  assert.equal(Object.hasOwn(first.run, 'inputs'), false)
  assert.equal(f.calls.length, 1)
  assert.deepEqual(f.calls[0][2], jobInputs)
  const detail = await f.bridge.dispatch(
    f.message({ command: 'run', runId: first.run.runId })
  )
  assert.equal(detail.run.inputs.opaque, '<redacted>')
  assert.equal(detail.run.inputs.apiToken, '<redacted>')
  await rejectsCode(
    f.bridge.dispatch(f.message({ jobInputs: { enabled: true } })),
    'QUEST_INPUT_INVALID'
  )
  assert.equal(f.calls.length, 1)
  f.complete({ unrelated: 'Promise settlement is not terminal evidence' })
  await new Promise((resolve) => setImmediate(resolve))
  assert.equal(f.bridge.runs.get('canonical-1').state, 'running')
})

test('Quest uncertain admission and synchronous exceptions retain invocation keys to prevent repeat execution', async () => {
  for (const mode of ['missing-start', 'throw-after-start']) {
    const f = fixture()
    f.sails.quest.run = () => {
      f.calls.push(['run'])
      if (mode === 'throw-after-start')
        throw new Error('Unconfirmed spawn failure')
      return Promise.resolve()
    }
    await assert.rejects(f.bridge.dispatch(f.message()))
    await assert.rejects(f.bridge.dispatch(f.message()))
    assert.equal(f.calls.length, 1, `${mode} must not retry execution`)
  }
})

test('Quest recognizes explicit asynchronous pre-spawn rejection without inventing an execution', async () => {
  const f = fixture()
  f.sails.quest.run = () => {
    f.calls.push(['run'])
    const error = Object.assign(new Error('Sensitive validation details'), {
      code: 'E_QUEST_ADMISSION_REJECTED',
      admission: 'rejected_before_start',
      phase: 'validation',
      validationCode: 'E_INVALID_ARGINS'
    })
    f.sails.emit('quest:job:error', {
      name: f.source.name,
      runtimeId: f.info.runtimeId,
      runId: 'not-an-execution',
      sequence: 1,
      admission: error.admission,
      phase: error.phase,
      error
    })
    return Promise.reject(error)
  }
  for (let attempt = 0; attempt < 2; attempt++)
    await rejectsCode(f.bridge.dispatch(f.message()), 'QUEST_INPUT_INVALID')
  assert.equal(f.calls.length, 1)
  assert.equal(f.bridge.runs.size, 0)
  const unmarked = fixture()
  unmarked.sails.quest.run = () =>
    Promise.reject(new Error('Lost spawn acknowledgement'))
  await rejectsCode(
    unmarked.bridge.dispatch(unmarked.message()),
    'QUEST_UNCONFIRMED'
  )
  const pending = fixture()
  pending.sails.quest.run = () => new Promise(() => {})
  await rejectsCode(
    pending.bridge.dispatch(pending.message()),
    'QUEST_UNCONFIRMED'
  )
})

test('Quest preserves observed canonical admission if the call throws after start', async () => {
  const f = fixture()
  const invoke = f.sails.quest.run
  f.sails.quest.run = (name, inputs) => {
    invoke(name, inputs)
    throw new Error('Response failed after the start event')
  }
  const accepted = await f.bridge.dispatch(f.message())
  assert.equal(accepted.run.runId, 'canonical-1')
  assert.equal(accepted.run.state, 'running')
  assert.deepEqual(await f.bridge.dispatch(f.message()), accepted)
  assert.equal(f.calls.length, 1)
})

test('Quest records an identified skip as a no-child outcome and preserves a known origin', async () => {
  const f = fixture()
  f.sails.quest.run = (name) => {
    f.calls.push(['run'])
    f.sails.emit('quest:job:skip', {
      name,
      runId: 'skipped-1',
      runtimeId: f.info.runtimeId,
      sequence: 1,
      startedAt: 1000,
      timestamp: 1000,
      reason: 'already_running'
    })
    return Promise.resolve([
      { skipped: true, reason: 'already_running', runId: 'skipped-1' }
    ])
  }
  const response = await f.bridge.dispatch(f.message())
  assert.equal(response.run.state, 'skipped')
  assert.equal(response.run.startedAt, null)
  assert.equal(response.run.exitCode, null)
  assert.equal(response.run.trigger, 'manual')
  assert.equal(
    f.bridge.runs.get('skipped-1').error,
    'An execution was already running; no script started.'
  )
  f.sails.emit('quest:job:skip', {
    name: f.source.name,
    runId: 'scheduled-skip',
    runtimeId: f.info.runtimeId,
    sequence: 2,
    timestamp: 1001,
    reason: 'paused',
    trigger: 'scheduled'
  })
  assert.equal(f.bridge.runs.get('scheduled-skip').trigger, 'scheduled')
  f.sails.emit('quest:job:skip', {
    name: f.source.name,
    runId: 'unknown-skip',
    runtimeId: f.info.runtimeId,
    sequence: 3,
    timestamp: 1002,
    reason: 'paused'
  })
  assert.equal(f.bridge.runs.get('unknown-skip').trigger, 'unknown')
})

test('Quest preserves numeric process failure and named exit despite bounded result loss', () => {
  const f = fixture()
  f.sails.emit('quest:job:error', {
    name: f.source.name,
    runId: 'failed-process',
    runtimeId: f.info.runtimeId,
    sequence: 1,
    error: { message: 'Synthetic failure', code: 1 }
  })
  assert.equal(f.bridge.runs.get('failed-process').exitCode, 1)
  f.sails.emit('quest:job:complete', {
    name: f.source.name,
    runId: 'large-exit',
    runtimeId: f.info.runtimeId,
    sequence: 2,
    result: {
      status: 'available',
      exit: 'noRecords',
      value: 'x'.repeat(129 * 1024)
    }
  })
  assert.deepEqual(f.bridge.runs.get('large-exit').result, {
    status: 'too_large',
    exit: 'noRecords'
  })
})

test('Quest pause and overlap checks fail closed and invoke only the named resident scheduler methods', async () => {
  const f = fixture()
  await f.bridge.dispatch(f.message({ command: 'pause' }))
  await rejectsCode(f.bridge.dispatch(f.message()), 'QUEST_PAUSED')
  assert.deepEqual(f.calls, [['pause', 'reports/daily']])
  await f.bridge.dispatch(f.message({ command: 'resume' }))
  f.source.runningCount = 1
  await rejectsCode(f.bridge.dispatch(f.message()), 'QUEST_ALREADY_RUNNING')
  f.source.runningCount = 0
  await f.bridge.dispatch(f.message())
  assert.deepEqual(
    f.calls.map(([kind]) => kind),
    ['pause', 'resume', 'run']
  )
  f.sails.quest.pause = () => {}
  await rejectsCode(
    f.bridge.dispatch(f.message({ command: 'pause' })),
    'QUEST_UNCONFIRMED'
  )
  delete f.sails.quest.pause
  const snapshot = await f.bridge.dispatch(f.message({ command: 'snapshot' }))
  assert.equal(snapshot.capabilities.pause, false)
  assert.equal(snapshot.capabilities.cancel, false)
  await rejectsCode(
    f.bridge.dispatch(f.message({ command: 'pause' })),
    'QUEST_UNAVAILABLE'
  )
  await rejectsCode(
    f.bridge.dispatch(f.message({ command: 'cancel' })),
    'QUEST_INPUT_INVALID'
  )
})

test('Quest named business exits remain separate from process completion, and terminal evidence is monotonic', async () => {
  const f = fixture()
  await f.bridge.dispatch(
    f.message({ jobInputs: { count: 0, enabled: false } })
  )
  const event = {
    name: f.source.name,
    runId: 'canonical-1',
    runtimeId: f.info.runtimeId,
    sequence: 2,
    finishedAt: 2000,
    result: { status: 'available', exit: 'invalid', value: false },
    logs: { stdout: 'completed\n', stderr: 'useful warning\n' }
  }
  f.sails.emit('quest:job:complete', event)
  const run = f.bridge.runs.get('canonical-1')
  assert.equal(run.state, 'completed')
  assert.equal(run.exitCode, 0)
  assert.deepEqual(run.result, event.result)
  assert.equal(run.stderr, 'useful warning')
  assert.deepEqual(run.inputs, { count: 0, enabled: false })
  f.sails.emit('quest:job:error', { ...event, sequence: 3, exitCode: 9 })
  f.sails.emit('quest:job:start', { ...event, sequence: 1 })
  f.sails.emit('quest:job:complete', {
    ...event,
    runId: 'foreign',
    runtimeId: 'foreign'
  })
  assert.equal(f.bridge.runs.get('canonical-1').state, 'completed')
  assert.equal(f.bridge.runs.has('foreign'), false)
  const snapshot = await f.bridge.dispatch(f.message({ command: 'snapshot' }))
  for (const name of ['stdout', 'stderr', 'result', 'inputs', 'error'])
    assert.equal(Object.hasOwn(snapshot.runs[0], name), false)
})

test('Quest resident results and UTF-8 logs are bounded, redacted, and separated from summaries', () => {
  const f = fixture()
  f.bridge.record('completed', {
    name: f.source.name,
    runId: 'bounded',
    runtimeId: f.info.runtimeId,
    sequence: 2,
    result: { status: 'available', value: 'x'.repeat(128 * 1024) },
    logs: { stdout: '🚀'.repeat(20000), stderr: 'é'.repeat(40000) }
  })
  const run = f.bridge.runs.get('bounded')
  assert.deepEqual(run.result, { status: 'too_large' })
  assert.ok(Buffer.byteLength(run.stdout) <= 32768)
  assert.ok(Buffer.byteLength(run.stderr) <= 32768)
  assert.equal(run.stdout.includes('\ufffd'), false)
  assert.equal(run.logsTruncated, true)
  const event = questEvent(
    {
      name: f.source.name,
      runId: 'telemetry',
      runtimeId: f.info.runtimeId,
      sequence: 1,
      inputs: { opaque: 'private', apiToken: 'private' },
      result: { status: 'available', value: 'x'.repeat(16 * 1024) },
      logs: { stdout: '🚀'.repeat(4000), stderr: 'TOKEN=private' }
    },
    'completed',
    { sails: f.sails, appId: '12', deploymentId: '34' }
  )
  assert.equal(event.inputs.opaque, '<redacted>')
  assert.equal(event.inputs.apiToken, '<redacted>')
  assert.equal(event.result.status, 'too_large')
  assert.ok(Buffer.byteLength(event.stdout) <= 2048)
  assert.equal(event.stdout.includes('\ufffd'), false)
  assert.equal(event.stderr, 'TOKEN=<redacted>')
  assert.equal(event.logsTruncated, true)
})

test('Quest bounds evidence from more than 32 scheduled active runs without cancelling execution', () => {
  const f = fixture()
  let cancelled = 0
  f.sails.quest.cancel = () => cancelled++
  for (let i = 0; i < 40; i++)
    f.bridge.record('running', {
      name: f.source.name,
      runId: `scheduled-${i}`,
      runtimeId: f.info.runtimeId,
      sequence: 1,
      startedAt: 1000 + i
    })
  assert.equal(f.bridge.runs.size, 32)
  assert.equal(f.bridge.runs.has('scheduled-0'), false)
  assert.equal(f.bridge.runs.has('scheduled-39'), true)
  assert.equal(cancelled, 0)
  assert.equal(f.calls.length, 0)
})

test('Quest runtime rejects transient and mismatched process identities without opening a socket', async () => {
  for (const changes of [
    { platform: 'darwin' },
    { env: { SLIPWAY_HELM_EXECUTION_ID: 'temporary' } },
    { env: { SLIPWAY_APP_ID: 'wrong', SLIPWAY_DEPLOYMENT_ID: '34' } }
  ]) {
    const f = fixture()
    const bridge = createQuestRuntime({
      sails: f.sails,
      appId: '12',
      deploymentId: '34',
      runtime: { platform: 'linux', env: {}, ...changes }
    })
    assert.equal(await bridge.start(), false)
    await bridge.stop()
  }
})

test('Quest private socket registration is owner-only and viewer disconnect never cancels a resident run', async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'quest-unit-'))
  const f = fixture()
  f.sails.removeAllListeners()
  let cancelled = 0
  f.sails.quest.cancel = () => cancelled++
  const bridge = createQuestRuntime({
    sails: f.sails,
    appId: '12',
    deploymentId: '34',
    directory,
    runtime: {
      platform: 'linux',
      pid: process.pid,
      getuid: () => process.getuid(),
      env: { SLIPWAY_APP_ID: '12', SLIPWAY_DEPLOYMENT_ID: '34' }
    }
  })
  let socket
  try {
    assert.equal(await bridge.start(), true)
    const stem = path.join(directory, `12-34-${process.pid}`)
    const identity = JSON.parse(fs.readFileSync(`${stem}.json`, 'utf8'))
    assert.equal(identity.runtimeId, f.info.runtimeId)
    assert.equal(identity.pid, process.pid)
    assert.ok(/^\d+$/.test(identity.startTicks))
    for (const filename of [directory, `${stem}.json`, `${stem}.sock`])
      assert.equal(fs.statSync(filename).mode & 0o077, 0)
    const response = await new Promise((resolve, reject) => {
      socket = net.createConnection(`${stem}.sock`)
      socket.once('error', reject)
      socket.once('connect', () =>
        socket.write(JSON.stringify(f.message()) + '\n')
      )
      socket.once('data', (data) => resolve(JSON.parse(data.toString())))
    })
    assert.equal(response.ok, true)
    assert.equal(response.data.run.runId, 'canonical-1')
    socket.destroy()
    await new Promise((resolve) => setImmediate(resolve))
    assert.equal(bridge.runs.get('canonical-1').state, 'running')
    assert.equal(cancelled, 0)
    f.complete()
    assert.equal(bridge.runs.get('canonical-1').state, 'running')
  } finally {
    socket?.destroy()
    await bridge.stop()
    fs.rmSync(directory, { recursive: true, force: true })
  }
})

function privateRuntime(sails, directory, pid = process.pid) {
  return createQuestRuntime({
    sails,
    appId: '12',
    deploymentId: '34',
    directory,
    runtime: {
      platform: 'linux',
      pid,
      getuid: () => process.getuid(),
      env: { SLIPWAY_APP_ID: '12', SLIPWAY_DEPLOYMENT_ID: '34' }
    }
  })
}

test('Quest restart reconciliation leaves current, malformed, unrelated, symlink and non-private registrations untouched', async () => {
  const {
    startTicks
  } = require('../../../packages/hook/lib/helm-runtime-contract')
  const ticks = startTicks(fs.readFileSync('/proc/self/stat', 'utf8'))
  for (const scenario of [
    'current',
    'malformed',
    'other-app',
    'other-deployment',
    'other-pid',
    'other-socket',
    'missing-ticks',
    'other-owner',
    'socket-owner',
    'registration-mode',
    'socket-mode',
    'registration-symlink',
    'socket-symlink',
    'socket-file',
    'orphan-socket',
    'orphan-registration'
  ]) {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'quest-safety-'))
    const stem = path.join(directory, `12-34-${process.pid}`)
    const socketPath = `${stem}.sock`
    const filename = `${stem}.json`
    const identity = {
      version: 1,
      appId: '12',
      deploymentId: '34',
      runtimeId: 'previous',
      pid: process.pid,
      startTicks: ticks === '1' ? '2' : '1',
      socket: socketPath
    }
    if (scenario === 'current') identity.startTicks = ticks
    if (scenario === 'other-app') identity.appId = '99'
    if (scenario === 'other-deployment') identity.deploymentId = '99'
    if (scenario === 'other-pid') identity.pid++
    if (scenario === 'other-socket')
      identity.socket = `${directory}/unrelated.sock`
    if (scenario === 'missing-ticks') delete identity.startTicks
    const content =
      scenario === 'malformed' ? '{invalid' : JSON.stringify(identity)
    fs.writeFileSync(filename, content, { mode: 0o600 })
    fs.writeFileSync(socketPath, 'socket stand-in', { mode: 0o600 })
    const unrelated = path.join(directory, 'unrelated')
    fs.writeFileSync(unrelated, 'untouched', { mode: 0o600 })
    if (scenario === 'registration-mode') fs.chmodSync(filename, 0o644)
    if (scenario === 'socket-mode') fs.chmodSync(socketPath, 0o666)
    if (scenario === 'registration-symlink') {
      fs.unlinkSync(filename)
      fs.symlinkSync(unrelated, filename)
    }
    if (scenario === 'socket-symlink') {
      fs.unlinkSync(socketPath)
      fs.symlinkSync(unrelated, socketPath)
    }
    if (scenario === 'orphan-socket') fs.unlinkSync(filename)
    if (scenario === 'orphan-registration') fs.unlinkSync(socketPath)
    const originalStat = fs.lstatSync
    const originalServer = net.createServer
    let serverCreations = 0
    // A local socket is not available in every unit-test sandbox. Only socket
    // type and ownership are doubled here; actual stale sockets are below.
    fs.lstatSync = function (file, ...args) {
      const stat = originalStat.call(fs, file, ...args)
      const adjusted = Object.create(stat)
      if (
        file === socketPath &&
        !stat.isSymbolicLink() &&
        scenario !== 'socket-file'
      )
        adjusted.isSocket = () => true
      if (
        (scenario === 'other-owner' && file === filename) ||
        (scenario === 'socket-owner' && file === socketPath)
      )
        adjusted.uid = process.getuid() + 1
      return adjusted
    }
    net.createServer = () => {
      serverCreations++
      throw new Error('Unsafe reconciliation must fail before listening')
    }
    const bridge = privateRuntime(fixture().sails, directory)
    try {
      await assert.rejects(
        bridge.start(),
        { code: 'QUEST_UNAVAILABLE' },
        scenario
      )
      await bridge.stop()
      assert.equal(serverCreations, 0, scenario)
      assert.equal(fs.readFileSync(unrelated, 'utf8'), 'untouched', scenario)
      if (scenario !== 'orphan-socket') {
        assert.ok(originalStat(filename), scenario)
        assert.equal(
          fs.readFileSync(filename, 'utf8'),
          scenario === 'registration-symlink' ? 'untouched' : content,
          scenario
        )
      }
      if (scenario !== 'orphan-registration')
        assert.ok(originalStat(socketPath), scenario)
    } finally {
      fs.lstatSync = originalStat
      net.createServer = originalServer
      await bridge.stop()
      fs.rmSync(directory, { recursive: true, force: true })
    }
  }
})

test('Quest first restart replaces only a verified stale socket left by a killed disposable process', async () => {
  const { spawn } = require('node:child_process')
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'quest-restart-'))
  const source = `
    const fs = require('node:fs')
    const net = require('node:net')
    const directory = process.argv[1]
    const socket = directory + '/12-34-' + process.pid + '.sock'
    const stat = fs.readFileSync('/proc/self/stat', 'utf8')
    const ticks = stat.slice(stat.lastIndexOf(')') + 1).trim().split(/\\s+/)[19]
    const server = net.createServer()
    server.once('error', error => { process.send({ error: error.code }); process.exitCode = 1 })
    server.listen(socket, () => {
      fs.chmodSync(socket, 0o600)
      fs.writeFileSync(socket.replace(/\\.sock$/, '.json'), JSON.stringify({
        version: 1, appId: '12', deploymentId: '34', runtimeId: 'dead-runtime',
        pid: process.pid, startTicks: ticks, socket
      }), { mode: 0o600 })
      process.send({ pid: process.pid, socket, ticks })
    })
  `
  const child = spawn(process.execPath, ['-e', source, directory], {
    stdio: ['ignore', 'ignore', 'ignore', 'ipc']
  })
  const exited = new Promise((resolve) => child.once('exit', resolve))
  let bridge, duplicate
  try {
    const old = await new Promise((resolve, reject) => {
      child.once('error', reject)
      child.once('message', (message) => {
        if (message.error)
          reject(
            Object.assign(
              new Error(`Disposable Unix socket: ${message.error}`),
              { code: message.error }
            )
          )
        else resolve(message)
      })
      child.once('exit', (code) =>
        reject(new Error(`Disposable socket process exited ${code}`))
      )
    })
    child.kill('SIGKILL')
    await exited
    assert.equal(fs.lstatSync(old.socket).isSocket(), true)
    const filename = old.socket.replace(/\.sock$/, '.json')
    const unrelated = path.join(directory, 'unrelated.sock')
    fs.writeFileSync(unrelated, 'untouched', { mode: 0o600 })
    // Inject the old PID to model kernel PID reuse, while retaining this new
    // process's actual /proc/self start ticks. The stale socket is real.
    bridge = privateRuntime(fixture().sails, directory, old.pid)
    assert.equal(await bridge.start(), true)
    const current = JSON.parse(fs.readFileSync(filename, 'utf8'))
    assert.notEqual(current.startTicks, old.ticks)
    assert.equal(current.runtimeId, 'runtime-fixture')
    assert.equal(fs.lstatSync(old.socket).isSocket(), true)
    assert.equal(fs.lstatSync(old.socket).mode & 0o077, 0)
    assert.equal(fs.lstatSync(filename).mode & 0o077, 0)
    assert.equal(fs.readFileSync(unrelated, 'utf8'), 'untouched')
    duplicate = privateRuntime(fixture().sails, directory, old.pid)
    await assert.rejects(duplicate.start(), { code: 'QUEST_UNAVAILABLE' })
    await duplicate.stop()
    assert.deepEqual(JSON.parse(fs.readFileSync(filename, 'utf8')), current)
    assert.equal(fs.lstatSync(old.socket).isSocket(), true)
    const response = await new Promise((resolve, reject) => {
      const socket = net.createConnection(old.socket)
      socket.once('error', reject)
      socket.once('connect', () =>
        socket.write(
          JSON.stringify({
            command: 'snapshot',
            appId: '12',
            deploymentId: '34'
          }) + '\n'
        )
      )
      socket.once('data', (data) => {
        socket.destroy()
        resolve(JSON.parse(data.toString()))
      })
    })
    assert.equal(response.ok, true)
  } finally {
    if (child.exitCode === null && child.signalCode === null)
      child.kill('SIGKILL')
    await exited
    await duplicate?.stop()
    await bridge?.stop()
    fs.rmSync(directory, { recursive: true, force: true })
  }
})

test('Quest schedule metadata preserves explicit registration validation and restart scope', () => {
  const source = {
    name: 'reports',
    inputs: {},
    schedule: { date: '2020-01-01T00:00:00.000Z', timezone: null },
    scheduled: false,
    scheduleState: {
      registration: 'not_registered',
      validation: 'valid',
      validationErrors: [],
      reason: 'no_future_run',
      lastAttemptAt: '2026-10-03T20:00:00.000Z',
      restart: {
        persistence: 'memory_only',
        timing: 'wall_clock',
        oneShot: true,
        missedRuns: 'not_replayed'
      }
    }
  }
  const job = describeJob(source)
  assert.deepEqual(job.scheduleState, source.scheduleState)
  assert.equal(job.scheduled, false)
  assert.equal(job.validationErrors, undefined)
  assert.equal(
    describeJob({ ...source, scheduleState: undefined }).scheduleState,
    null
  )
  assert.equal(
    describeJob({
      ...source,
      scheduleState: { ...source.scheduleState, validation: 'assumed' }
    }).scheduleState,
    null
  )
  const bounded = describeJob({
    ...source,
    scheduleState: {
      ...source.scheduleState,
      registration: 'failed',
      validation: 'invalid',
      lastAttemptAt: 'invalid',
      validationErrors: Array.from({ length: 20 }, () => ({
        code: 'unsafe code',
        message: 'x'.repeat(1000)
      }))
    }
  }).scheduleState
  assert.equal(bounded.validationErrors.length, 8)
  assert.equal(bounded.validationErrors[0].message.length, 512)
  assert.equal(bounded.validationErrors[0].code, 'QUEST_SCHEDULE_INVALID')
  assert.equal(bounded.lastAttemptAt, null)
})

test('Quest invalid source schedule remains separate from valid manual admission', async () => {
  const f = fixture({
    scheduleState: {
      registration: 'failed',
      validation: 'invalid',
      validationErrors: [
        { code: 'E_INVALID_CRON', message: 'The cron expression is invalid.' }
      ],
      reason: null,
      lastAttemptAt: null,
      restart: {
        persistence: 'memory_only',
        timing: 'wall_clock',
        oneShot: false,
        missedRuns: 'not_replayed'
      }
    }
  })
  const described = describeJob(f.source)
  assert.equal(described.scheduleState.validation, 'invalid')
  assert.equal(described.validationErrors, undefined)
  const accepted = await f.bridge.dispatch(f.message())
  assert.equal(accepted.run.runId, 'canonical-1')
  assert.equal(f.calls.filter(([command]) => command === 'run').length, 1)
})

test('Quest observed termination signals remain separate from exit status and skipped admission', async () => {
  for (const [signal, expected] of [
    ['SIGTERM', 'SIGTERM'],
    ['SIGKILL', 'SIGKILL'],
    ['invalid text', null],
    [null, null]
  ]) {
    const f = fixture()
    const accepted = await f.bridge.dispatch(f.message())
    const data = {
      name: f.source.name,
      runId: accepted.run.runId,
      runtimeId: f.info.runtimeId,
      sequence: 2,
      startedAt: 1000,
      finishedAt: 2000,
      exitCode: null,
      signal,
      error: { message: 'The process did not exit normally.' }
    }
    f.sails.emit('quest:job:error', data)
    const { run } = await f.bridge.dispatch({
      command: 'run',
      appId: '12',
      deploymentId: '34',
      runId: accepted.run.runId
    })
    assert.equal(run.state, 'failed')
    assert.equal(run.exitCode, null)
    assert.equal(run.signal, expected)
    const event = questEvent(data, 'failed', {
      sails: f.sails,
      appId: '12',
      deploymentId: '34'
    })
    assert.equal(event.signal, expected)
    assert.equal(event.exitCode, null)
    assert.equal(
      questEvent({ ...data, reason: 'paused' }, 'skipped', { sails: f.sails })
        .signal,
      null
    )
  }
})

test('Quest source schedule preserves zero delay and the authoritative nullable runtime timezone', () => {
  assert.equal(
    describeJob({ name: 'immediate', inputs: {}, schedule: { timeout: 0 } })
      .scheduleType,
    'timeout'
  )
  assert.equal(
    describeJob({
      name: 'manual',
      inputs: {},
      schedule: { interval: false, timeout: false, date: false }
    }).scheduleType,
    'manual'
  )
  const job = describeJob({
    name: 'cron',
    inputs: {},
    schedule: {
      cron: '0 9 * * *',
      timezone: null,
      cronOptions: { timezone: 'Europe/London', tz: null }
    }
  })
  assert.equal(job.timezone, null)
  assert.equal(
    describeJob({
      name: 'cron',
      inputs: {},
      schedule: {
        cron: '0 9 * * *',
        timezone: 'America/New_York',
        cronOptions: { tz: 'America/New_York' }
      }
    }).timezone,
    'America/New_York'
  )
})
