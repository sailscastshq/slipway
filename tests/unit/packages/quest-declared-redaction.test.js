const assert = require('node:assert/strict')
const http = require('node:http')
const { EventEmitter } = require('node:events')
const { test } = require('sounding')
const defineSlipwayHook = require('../../../packages/hook')
const {
  createQuestRuntime,
  safeValue
} = require('../../../packages/hook/lib/quest-runtime')
const questEvent = require('../../../packages/hook/lib/quest-event')
const {
  createQuestRedactor,
  questRedactor,
  UNAVAILABLE
} = require('../../../packages/hook/lib/quest-redaction')

// Pure adapter tests: synthetic lifecycle events only. No job, child, socket,
// browser or upstream runtime is started, and no real request is sent.
function fixture(inputs, scheduledInputs) {
  const sails = new EventEmitter()
  const metadata = { name: 'fixture', inputs, scheduledInputs }
  sails.quest = {
    metadata: (name) => (name ? metadata : [metadata]),
    getRuntime: () => ({
      runtimeId: 'fixture-runtime',
      contractVersion: 1,
      capabilities: {
        residentState: true,
        runIdentity: true,
        childSchedulerSuppression: true
      }
    })
  }
  const runtime = createQuestRuntime({ sails, appId: '7', deploymentId: '42' })
  const event = (extra) => ({
    name: 'fixture',
    runtimeId: 'fixture-runtime',
    runId: 'fixture-run',
    sequence: 1,
    ...extra
  })
  const telemetry = (data, state) =>
    questEvent(data, state, { sails, appId: '7', deploymentId: '42' })
  return { sails, metadata, runtime, event, telemetry }
}

function hiddenSource(source = 'job_input') {
  return {
    validation: 'not_checked',
    values: {},
    fields: {
      opaque: { source, sensitive: true, available: false, reason: 'sensitive' }
    }
  }
}

function excludes(value, secrets) {
  const json = JSON.stringify(value)
  for (const secret of secrets) assert.equal(json.includes(secret), false)
}

test('Declared inputs redact completed chunk boundaries, nested copies, result scalars and omitted terminal inputs', async () => {
  const strings = [
    'plain-hidden-α-value',
    'protected-hidden-value',
    'declared-hidden-value',
    'nested-key-hidden-value'
  ]
  const f = fixture({
    opaque: { sensitive: true },
    bundle: { protect: true },
    other: { secret: true },
    public: {},
    payload: {}
  })
  const inputs = {
    opaque: strings[0],
    bundle: { nested: [strings[1]] },
    other: strings[2],
    public: '  ordinary\ntext  \n',
    payload: { apiKey: strings[3], harmless: 'still useful' }
  }
  const start = f.event({ inputs })
  f.runtime.record('running', start)
  const startEvent = f.telemetry(start, 'running')
  const output = Buffer.from(`before ${strings.join(' / ')} after`)
  const split = output.indexOf(Buffer.from('α')) + 1
  const chunks = [
    output.subarray(0, 12),
    output.subarray(12, split),
    output.subarray(split)
  ]
  // The adapter receives the completed tail, so both character and write
  // boundaries have been reassembled before redaction.
  const terminal = f.event({
    sequence: 2,
    result: { status: 'available', exit: 'noRecords', value: strings[0] },
    logs: {
      stdout: Buffer.concat(chunks).toString('utf8'),
      stderr: `warning ${strings[1]}`
    },
    error: { message: `failure ${strings[2]}` }
  })
  f.runtime.record('completed', terminal)
  const telemetry = f.telemetry(terminal, 'completed')
  const run = f.runtime.runs.get('fixture-run')
  for (const record of [run, telemetry]) {
    assert.deepEqual(record.result, {
      status: 'available',
      exit: 'noRecords',
      value: '<redacted>'
    })
    assert.equal(record.inputs.opaque, '<redacted>')
    assert.equal(record.inputs.bundle, '<redacted>')
    assert.equal(record.inputs.other, '<redacted>')
    assert.equal(record.inputs.payload.apiKey, '<redacted>')
    assert.equal(record.inputs.public, inputs.public)
    assert.equal(record.inputs.payload.harmless, 'still useful')
    assert.match(record.stdout, /^before .* after$/)
    assert.equal(record.error, 'failure <redacted>')
  }
  const detail = await f.runtime.dispatch({
    command: 'run',
    runId: 'fixture-run',
    appId: '7',
    deploymentId: '42'
  })
  const snapshot = await f.runtime.dispatch({
    command: 'snapshot',
    appId: '7',
    deploymentId: '42'
  })
  excludes({ detail, snapshot, startEvent, telemetry }, strings)
  assert.equal(Object.hasOwn(snapshot.runs[0], 'inputs'), false)
  assert.equal(Object.hasOwn(snapshot.runs[0], 'redactor'), false)
  assert.equal(JSON.stringify(detail).includes('patterns'), false)
  // The original event remains raw for the upstream process; it was not mutated.
  assert.equal(inputs.opaque, strings[0])
})

test('Declared input redaction preserves ordinary values and whitespace while redacting typed scalar returns', () => {
  for (const secret of [
    782391,
    false,
    null,
    '',
    'a',
    '[.*+$]',
    'value',
    'available'
  ]) {
    const f = fixture({ opaque: { sensitive: true } })
    const data = f.event({
      inputs: { opaque: secret },
      result: { status: 'available', value: secret }
    })
    f.runtime.record('completed', data)
    assert.equal(f.runtime.runs.get(data.runId).result.value, '<redacted>')
    assert.equal(f.telemetry(data, 'completed').result.value, '<redacted>')
  }
  const reserved = fixture({ opaque: { sensitive: true }, value: {} })
  const reservedEvent = reserved.telemetry(
    reserved.event({
      inputs: { opaque: 'value', value: 'ordinary input' },
      result: { status: 'available', value: { value: 'value' } }
    }),
    'completed'
  )
  assert.deepEqual(reservedEvent.inputs, {
    opaque: '<redacted>',
    value: 'ordinary input'
  })
  assert.deepEqual(reservedEvent.result, {
    status: 'available',
    value: { '<redacted>': '<redacted>' }
  })
  const f = fixture({ opaque: { sensitive: true }, ordinary: {} })
  const data = f.event({
    inputs: { opaque: 'redacted', ordinary: '  first\nsecond  \n' },
    result: {
      status: 'available',
      value: { text: '  redacted\nkept  \n', count: 0, flag: false, nil: null }
    }
  })
  const event = f.telemetry(data, 'completed')
  assert.deepEqual(event.result.value, {
    text: '  <redacted>\nkept  \n',
    count: 0,
    flag: false,
    nil: null
  })
  assert.equal(event.inputs.ordinary, data.inputs.ordinary)
})

test('Known sensitive source defaults are redacted and hidden defaults fail closed without hiding explicit omission', () => {
  for (const source of ['schema_default', 'script_input', 'job_input']) {
    const f = fixture({ opaque: { sensitive: true } }, hiddenSource(source))
    const data = f.event({
      inputs: {},
      result: {
        status: 'available',
        exit: 'noRecords',
        value: 'unknown-source-value'
      },
      logs: { stdout: 'unknown-source-value', stderr: 'unknown-source-value' },
      error: { message: 'unknown-source-value' }
    })
    f.runtime.record('completed', data)
    for (const record of [
      f.runtime.runs.get(data.runId),
      f.telemetry(data, 'completed')
    ]) {
      assert.deepEqual(record.result, {
        status: 'unavailable',
        reason: 'redaction_unavailable',
        exit: 'noRecords'
      })
      assert.equal(record.stdout, UNAVAILABLE)
      assert.equal(record.stderr, UNAVAILABLE)
      assert.equal(record.error, UNAVAILABLE)
      assert.deepEqual(record.inputs, {})
    }
    // An explicit effective override gives us the matching value even though
    // public metadata still withholds the configured source default.
    const explicit = f.event({
      ...data,
      runId: 'overridden',
      inputs: { opaque: 'unknown-source-value' }
    })
    assert.equal(f.telemetry(explicit, 'completed').result.value, '<redacted>')
  }
  for (const metadata of [
    {
      inputs: {
        opaque: { protect: true, defaultsTo: 'hidden-default-fixture' }
      }
    },
    {
      inputs: { opaque: { sensitive: true } },
      scheduledInputs: {
        ...hiddenSource(),
        values: { opaque: 'hidden-default-fixture' }
      }
    }
  ]) {
    const f = fixture(metadata.inputs, metadata.scheduledInputs)
    const data = f.event({
      inputs: {},
      result: { status: 'available', value: 'hidden-default-fixture' }
    })
    assert.equal(f.telemetry(data, 'completed').result.value, '<redacted>')
  }
  const omitted = fixture(
    { opaque: { sensitive: true } },
    hiddenSource('omitted')
  )
  const data = omitted.event({
    inputs: {},
    result: { status: 'available', value: 'ordinary result' },
    logs: { stdout: 'ordinary output' }
  })
  assert.equal(
    omitted.telemetry(data, 'completed').result.value,
    'ordinary result'
  )
  assert.equal(omitted.telemetry(data, 'completed').stdout, 'ordinary output')
})

test('Declared redaction context is bounded with resident retention and runtime identity, and reused without terminal inputs', () => {
  const f = fixture({ opaque: { sensitive: true } }, hiddenSource())
  for (let index = 0; index < 40; index++) {
    const data = f.event({
      runId: `run-${index}`,
      inputs: { opaque: `hidden-${index}-fixture` }
    })
    f.runtime.record('running', data)
    f.telemetry(data, 'running')
  }
  assert.equal(f.runtime.runs.size, 32)
  const retained = f.event({
    runId: 'run-39',
    sequence: 2,
    result: { status: 'available', value: 'hidden-39-fixture' }
  })
  assert.equal(f.telemetry(retained, 'completed').result.value, '<redacted>')
  const evicted = f.event({
    runId: 'run-0',
    sequence: 2,
    result: { status: 'available', value: 'hidden-0-fixture' }
  })
  assert.equal(
    f.telemetry(evicted, 'completed').result.reason,
    'redaction_unavailable'
  )
  const restarted = { ...retained, runtimeId: 'new-runtime' }
  assert.equal(
    f.telemetry(restarted, 'completed').result.reason,
    'redaction_unavailable'
  )
})

test('Unbounded declared values and upstream-truncated sensitive tails never publish a partial secret', () => {
  const tooMany = Object.fromEntries(
    Array.from({ length: 300 }, (_, i) => [`key${i}`, `hidden-value-${i}`])
  )
  const cyclic = {}
  cyclic.self = cyclic
  for (const value of ['x'.repeat(65537), tooMany, cyclic]) {
    const f = fixture({ opaque: { sensitive: true } })
    const data = f.event({
      inputs: { opaque: value },
      result: { status: 'available', value: 'do not expose output' },
      logs: { stdout: 'do not expose output' }
    })
    f.runtime.record('completed', data)
    assert.equal(
      f.runtime.runs.get(data.runId).result.reason,
      'redaction_unavailable'
    )
    assert.equal(f.telemetry(data, 'completed').stdout, UNAVAILABLE)
  }
  const diagnostic = createQuestRedactor(
    { opaque: 'declared-private-suffix' },
    { inputs: { opaque: { sensitive: true } } }
  )
  assert.equal(
    diagnostic.text('private-suffix later ordinary output', { tail: true }),
    UNAVAILABLE
  )
  assert.equal(
    diagnostic.text('suffix later ordinary output', { tail: true }),
    UNAVAILABLE
  )
  assert.equal(
    diagnostic.text('complete declared-private-suffix diagnostic', {
      tail: true
    }),
    'complete <redacted> diagnostic'
  )
  const f = fixture({ opaque: { sensitive: true } })
  const data = f.event({
    inputs: { opaque: 'long-hidden-fixture-value' },
    logs: { stdout: 'fixture-value ordinary output', stdoutTruncated: true }
  })
  assert.equal(f.telemetry(data, 'completed').stdout, UNAVAILABLE)
  const clean = fixture({ ordinary: {} })
  assert.equal(
    clean.telemetry(
      clean.event({ inputs: { ordinary: 'safe' }, logs: data.logs }),
      'completed'
    ).stdout,
    data.logs.stdout
  )
})

test('Redaction handles literal regex characters, overlapping matches and private helper context without recursive markers', () => {
  const redactor = createQuestRedactor(
    { a: '[.*+$]', b: 'redacted', c: 'act' },
    {
      inputs: {
        a: { sensitive: true },
        b: { protect: true },
        c: { secret: true }
      }
    }
  )
  assert.equal(
    redactor.text('[.*+$] redacted act'),
    '<redacted> <redacted> <redacted>'
  )
  assert.equal(JSON.stringify(redactor), '{"available":true}')
  assert.deepEqual(
    safeValue({ '[.*+$]': 'redacted' }, 0, new Set(), redactor),
    { '<redacted>': '<redacted>' }
  )
  const escaped = 'hidden-"quoted"-\\-\n-α'
  const jsonRedactor = createQuestRedactor(
    { opaque: { nested: escaped } },
    { inputs: { opaque: { sensitive: true } } }
  )
  const jsonLog = jsonRedactor.text(JSON.stringify({ echoed: escaped }))
  assert.equal(jsonLog, '{"echoed":"<redacted>"}')
  const f = fixture({ opaque: { sensitive: true } })
  questRedactor(
    f.sails,
    f.event({ inputs: { opaque: 'retained-metadata-error' } }),
    'running'
  )
  f.sails.quest.metadata = () => {
    throw new Error('metadata unavailable')
  }
  assert.equal(
    f.telemetry(
      f.event({
        sequence: 2,
        result: { status: 'available', value: 'retained-metadata-error' }
      }),
      'completed'
    ).result.value,
    '<redacted>'
  )
})

test('Declared secrets are excluded from every generic metric, exception, diagnostic and notification copy including legacy events', async () => {
  const requests = []
  const notifications = []
  const originalRequest = http.request
  http.request = () => {
    const request = new EventEmitter()
    let body = ''
    request.write = (chunk) => {
      body += chunk
    }
    request.end = () => requests.push(JSON.parse(body))
    request.destroy = () => {}
    return request
  }
  const f = fixture({ opaque: { sensitive: true } }, hiddenSource())
  const sails = f.sails
  Object.assign(sails, {
    config: {
      slipway: {
        quest: { enabled: false },
        wake: { enabled: false },
        bridge: { enabled: false },
        bearing: { enabled: false },
        flags: { enabled: false },
        lookout: {
          enabled: true,
          telemetryUrl: 'http://127.0.0.1/api/v1/telemetry/ingest',
          telemetryToken: 'stk_disposable-test',
          appId: '7',
          deploymentId: '42',
          heartbeatInterval: 60000,
          flushInterval: 60000,
          batchSize: 50,
          captureExceptions: false,
          captureQueries: false,
          captureQuestEvents: true,
          captureCache: false
        }
      }
    },
    hooks: { helpers: { furnishHelper: () => {} } },
    helpers: {
      notification: {
        sendJobFailureNotification: {
          with(value) {
            notifications.push(value)
            return { tolerate: () => {} }
          }
        }
      }
    },
    models: {},
    log: { verbose: () => {}, info: () => {}, warn: () => {} },
    after(event, callback) {
      if (event === 'hook:helpers:loaded') callback()
    }
  })
  const hook = defineSlipwayHook(sails)
  const secrets = [
    'declared-generic-hidden-fixture',
    'legacy-generic-hidden-fixture'
  ]
  try {
    await new Promise((resolve, reject) =>
      hook.initialize((error) => (error ? reject(error) : resolve()))
    )
    sails.emit(
      'quest:job:start',
      f.event({ inputs: { opaque: secrets[0], ordinary: 'retain me' } })
    )
    for (const [index, identity] of [
      f.event({ sequence: 2 }),
      { name: 'fixture', inputs: { opaque: secrets[1] } }
    ].entries()) {
      sails.emit('quest:job:error', {
        ...identity,
        result: { status: 'available', value: secrets[index] },
        logs: {
          stdout: `output ${secrets[index]}`,
          stderr: `warning ${secrets[index]}`
        },
        error: {
          message: `failure ${secrets[index]}`,
          stack: `stack ${secrets[index]}`,
          diagnostic: index
            ? secrets[index].slice(-12)
            : `diagnostic ${secrets[index]}`
        }
      })
    }
    excludes({ requests, notifications }, secrets)
    const metrics = requests.flatMap((request) => request.metrics)
    const exceptions = requests.flatMap((request) => request.exceptions)
    assert.equal(metrics.length, 3)
    assert.equal(exceptions.length, 2)
    assert.equal(notifications.length, 2)
    assert.equal(metrics[1].attributes.questRun.inputs.ordinary, 'retain me')
    assert.equal(metrics[2].attributes.inputs.opaque, '<redacted>')
    for (const [index, exception] of exceptions.entries()) {
      assert.match(exception.message, /failure <redacted>/)
      if (index) {
        assert.ok(exception.stackTrace.includes(UNAVAILABLE))
        assert.equal(
          exception.stackTrace.includes(secrets[index].slice(-12)),
          false
        )
      } else assert.match(exception.stackTrace, /diagnostic <redacted>/)
      assert.match(exception.stackTrace, /stack <redacted>/)
    }
    for (const notification of notifications)
      assert.equal(notification.errorMessage, 'failure <redacted>')
  } finally {
    await new Promise((resolve) => hook.teardown(resolve))
    http.request = originalRequest
  }
})
