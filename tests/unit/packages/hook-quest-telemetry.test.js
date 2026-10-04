const assert = require('node:assert/strict')
const crypto = require('node:crypto')
const http = require('node:http')
const https = require('node:https')
const { EventEmitter } = require('node:events')
const { test } = require('node:test')
const defineSlipwayHook = require('../../../packages/hook')
const questEvent = require('../../../packages/hook/lib/quest-event')
const {
  createQuestRuntime
} = require('../../../packages/hook/lib/quest-runtime')
const ingest = require('../../../api/controllers/api/v1/telemetry/ingest')
const {
  telemetryPayloads
} = require('../../../packages/hook/lib/telemetry-payloads')

// These deliberately use the receiver's public limits, not packetizer exports.
const EVENT_BYTES = 32 * 1024
const BATCH_BYTES = 512 * 1024
const COUNTS = { spans: 500, exceptions: 200, metrics: 1000 }
const TOKEN = 'stk_quest-telemetry-unit-test'
const NOW = Date.now()

function installGlobals(t, values) {
  const previous = Object.fromEntries(
    Object.keys(values).map((key) => [
      key,
      Object.getOwnPropertyDescriptor(global, key)
    ])
  )
  Object.assign(global, values)
  t.after(() => {
    for (const [key, descriptor] of Object.entries(previous)) {
      if (descriptor) Object.defineProperty(global, key, descriptor)
      else delete global[key]
    }
  })
}

function matches(record, where) {
  return Object.entries(where).every(([key, value]) =>
    value && typeof value === 'object'
      ? record[key] >= value['>=']
      : record[key] === value
  )
}

function createReceiver(t) {
  const stored = { spans: [], exceptions: [], metrics: [] }
  const runs = new Map()
  const warnings = []
  const budgetQueries = []
  let connection
  installGlobals(t, {
    Environment: {
      async findOne(where) {
        assert.equal(
          where.telemetryTokenHash,
          crypto.createHash('sha256').update(TOKEN).digest('hex')
        )
        return { id: '3', features: {} }
      }
    },
    App: {
      async findOne(where) {
        assert.equal(String(where.id), '7')
        if (where.environment !== undefined)
          assert.equal(where.environment, '3')
        return { id: '7', currentDeployment: '42' }
      }
    },
    Deployment: {
      async findOne(where) {
        assert.deepEqual(where, {
          id: '42',
          environment: '3',
          app: '7'
        })
        return { id: '42', app: '7', environment: '3' }
      }
    },
    TelemetryConnection: {
      async findOne() {
        return connection
      },
      create(values) {
        return {
          async fetch() {
            return (connection = { id: 'connection', ...values })
          }
        }
      },
      updateOne() {
        return {
          async set(values) {
            return (connection = { ...connection, ...values })
          }
        }
      }
    },
    ...Object.fromEntries(
      Object.entries({
        TelemetrySpan: 'spans',
        TelemetryException: 'exceptions',
        TelemetryMetric: 'metrics'
      }).map(([model, kind]) => [
        model,
        {
          async createEach(records) {
            stored[kind].push(...records)
          }
        }
      ])
    ),
    // Only persistence is fake: real admission, identity checks, result
    // sanitization and terminal-state updates still run in quest-run-ledger.
    QuestRun: {
      async findOne(where) {
        return [...runs.values()].find((run) => matches(run, where))
      },
      create(values) {
        return {
          async fetch() {
            assert.equal(runs.has(values.runId), false)
            const record = { id: runs.size + 1, updatedAt: NOW, ...values }
            runs.set(values.runId, record)
            return { ...record }
          }
        }
      },
      updateOne(where) {
        return {
          async set(values) {
            const record = [...runs.values()].find((run) => matches(run, where))
            if (!record) return undefined
            Object.assign(record, values)
            return { ...record }
          }
        }
      }
    },
    sails: {
      config: { custom: { observability: {} } },
      log: { warn: (...args) => warnings.push(args) },
      getDatastore(name) {
        assert.equal(name, 'observability')
        return {
          async sendNativeQuery(sql, values) {
            budgetQueries.push({ sql, values })
            return { changes: 1 }
          }
        }
      },
      helpers: {
        lookout: { resolveTelemetryState: { with: () => ({}) } }
      }
    }
  })
  return {
    stored,
    runs,
    warnings,
    budgetQueries,
    async receive(wire, authorization = `Bearer ${TOKEN}`) {
      // Exercise the actual action with exactly what JSON parsing on the
      // other side of HTTP receives, including nulls and escaped characters.
      return ingest.fn.call(
        {
          req: { headers: { authorization } },
          res: { set: () => {} }
        },
        JSON.parse(wire)
      )
    }
  }
}

async function createHook(t, lookout = {}) {
  const requests = []
  const intervals = []
  const logs = []
  t.mock.method(Date, 'now', () => NOW)
  t.mock.method(global, 'setInterval', (callback, delay) => {
    const timer = { callback, delay, unref() {} }
    intervals.push(timer)
    return timer
  })
  t.mock.method(global, 'clearInterval', () => {})
  const recordRequest = (options) => {
    const request = new EventEmitter()
    const chunks = []
    request.write = (chunk) => chunks.push(Buffer.from(chunk))
    request.end = () => {
      const wire = Buffer.concat(chunks).toString('utf8')
      assert.equal(
        Number(options.headers['Content-Length']),
        Buffer.byteLength(wire)
      )
      assert.equal(options.headers.Authorization, `Bearer ${TOKEN}`)
      requests.push({ request, options, wire, body: JSON.parse(wire) })
    }
    request.destroyed = false
    request.destroy = () => {
      request.destroyed = true
    }
    return request
  }
  t.mock.method(http, 'request', recordRequest)
  t.mock.method(https, 'request', recordRequest)
  const sails = new EventEmitter()
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
          telemetryUrl: 'https://telemetry.invalid/api/v1/telemetry/ingest',
          telemetryToken: TOKEN,
          appId: '7',
          deploymentId: '42',
          heartbeatInterval: 61000,
          flushInterval: 60000,
          batchSize: 50,
          captureExceptions: false,
          captureQueries: false,
          captureQuestEvents: true,
          captureCache: false,
          ...lookout
        }
      }
    },
    hooks: { helpers: { furnishHelper() {} } },
    helpers: {},
    models: {},
    quest: { metadata: () => ({ inputs: {} }) },
    log: Object.fromEntries(
      ['verbose', 'info', 'warn'].map((level) => [
        level,
        (...args) => logs.push(args)
      ])
    ),
    after(event, callback) {
      // Avoid publishing any runtime or starting a Sails application. The
      // helper-ready callback is all telemetry initialization needs.
      if (
        event === 'hook:helpers:loaded' &&
        callback.name !== 'publishHelmRuntime'
      )
        callback()
    }
  })
  const hook = defineSlipwayHook(sails)
  let stopped = false
  async function close() {
    if (stopped) return
    stopped = true
    await new Promise((resolve, reject) =>
      hook.teardown((error) => (error ? reject(error) : resolve()))
    )
  }
  t.after(close)
  await new Promise((resolve, reject) =>
    hook.initialize((error) => (error ? reject(error) : resolve()))
  )
  return {
    sails,
    hook,
    requests,
    logs,
    close,
    flush() {
      intervals.find((timer) => timer.delay === 60000).callback()
    },
    heartbeat() {
      intervals.find((timer) => timer.delay === 61000).callback()
    }
  }
}

function event(runId, overrides = {}) {
  return {
    name: 'synthetic-report',
    runId,
    runtimeId: 'synthetic-runtime',
    sequence: 2,
    timestamp: NOW,
    startedAt: NOW - 20,
    finishedAt: NOW,
    duration: 20,
    trigger: 'scheduled',
    inputs: {},
    result: { status: 'available', value: 0, exit: 'noRecords' },
    ...overrides
  }
}

function assertBounds(wire) {
  assert.ok(Buffer.byteLength(wire) <= BATCH_BYTES)
  const body = JSON.parse(wire)
  for (const [kind, limit] of Object.entries(COUNTS)) {
    assert.ok(body[kind].length <= limit, `${kind} count`)
    for (const item of body[kind])
      assert.ok(Buffer.byteLength(JSON.stringify(item)) <= EVENT_BYTES, kind)
  }
  return body
}

async function receiveAll(receiver, requests) {
  for (const { wire, body } of requests) {
    assertBounds(wire)
    const result = await receiver.receive(wire)
    for (const kind of Object.keys(COUNTS))
      assert.equal(result[kind], body[kind].length)
    assert.equal(result.clockAdjusted, 0)
  }
  assert.deepEqual(receiver.warnings, [])
}

test('Quest Date, ISO and numeric lifecycle timestamps survive HTTP JSON and real ingest validation', async (t) => {
  const receiver = createReceiver(t)
  const client = await createHook(t)
  const expected = new Map()
  const timestamps = [
    new Date(NOW - 1234),
    new Date(NOW - 2345).toISOString(),
    NOW - 3456,
    undefined,
    'invalid timestamp',
    new Date(NaN),
    NaN,
    Infinity,
    {}
  ]
  for (const [index, timestamp] of timestamps.entries()) {
    const normalized = index < 3 ? NOW - [1234, 2345, 3456][index] : NOW
    for (const kind of ['start', 'complete', 'skip', 'error']) {
      const runId = `${kind}-${index}`
      expected.set(runId, normalized)
      client.sails.emit(
        `quest:job:${kind}`,
        event(runId, {
          timestamp,
          duration: index % 2 ? NaN : Infinity,
          reason: 'paused',
          error: new Error('Synthetic failure')
        })
      )
    }
  }
  client.flush()
  await receiveAll(receiver, client.requests)
  assert.equal(receiver.stored.metrics.length, timestamps.length * 4)
  assert.equal(receiver.stored.exceptions.length, timestamps.length)
  for (const metric of receiver.stored.metrics) {
    assert.equal(metric.recordedAt, expected.get(metric.attributes.runId))
    assert.equal(metric.value, 0)
  }
  assert.deepEqual(
    receiver.stored.exceptions.map((exception) => exception.occurredAt),
    timestamps.map((_, index) => expected.get(`error-${index}`))
  )
  assert.equal(receiver.runs.size, timestamps.length * 4)
})

test('nested Quest timestamps preserve exact milliseconds through telemetry and resident bridge records', async (t) => {
  const receiver = createReceiver(t)
  const client = await createHook(t)
  client.sails.quest.getRuntime = () => ({
    contractVersion: 1,
    runtimeId: 'synthetic-runtime',
    capabilities: {
      residentState: true,
      runIdentity: true,
      childSchedulerSuppression: true
    }
  })
  const bridge = createQuestRuntime({
    sails: client.sails,
    appId: '7',
    deploymentId: '42'
  })
  const startedAt = Math.floor(NOW / 1000) * 1000 - 5000 + 789
  const finishedAt = startedAt + 3000
  const formats = [
    (value) => new Date(value),
    (value) => new Date(value).toISOString(),
    (value) => value
  ]
  for (const [index, format] of formats.entries()) {
    const runId = `precise-${index}`
    const started = event(runId, {
      sequence: 1,
      startedAt: format(startedAt),
      timestamp: format(startedAt),
      finishedAt: undefined
    })
    bridge.record('running', started)
    client.sails.emit('quest:job:start', started)
    const completed = event(runId, {
      startedAt: format(startedAt),
      timestamp: format(finishedAt),
      finishedAt: format(finishedAt),
      duration: finishedAt - startedAt
    })
    bridge.record('completed', completed)
    client.sails.emit('quest:job:complete', completed)
    // dispatch reads the in-memory bridge without calling start/listen or
    // creating a socket, child process or runtime registration file.
    const { run } = await bridge.dispatch({
      command: 'run',
      appId: '7',
      deploymentId: '42',
      runtimeId: 'synthetic-runtime',
      runId
    })
    assert.equal(run.requestedAt, startedAt)
    assert.equal(run.startedAt, startedAt)
    assert.equal(run.finishedAt, finishedAt)
  }
  client.flush()
  await receiveAll(receiver, client.requests)
  assert.equal(receiver.runs.size, formats.length)
  for (const run of receiver.runs.values()) {
    assert.equal(run.requestedAt, startedAt)
    assert.equal(run.startedAt, startedAt)
    assert.equal(run.finishedAt, finishedAt)
  }
  for (const metric of receiver.stored.metrics) {
    const run = metric.attributes.questRun
    assert.equal(run.requestedAt, startedAt)
    assert.equal(run.startedAt, startedAt)
    assert.equal(run.finishedAt, run.state === 'running' ? null : finishedAt)
    assert.equal(
      metric.recordedAt,
      run.state === 'running' ? startedAt : finishedAt
    )
  }
})

test('invalid Date lifecycle fields retain null and existing fallback semantics without NaN', (t) => {
  t.mock.method(Date, 'now', () => NOW)
  const sails = {
    quest: {
      metadata: () => ({ inputs: {} }),
      getRuntime: () => ({
        contractVersion: 1,
        runtimeId: 'synthetic-runtime',
        capabilities: {
          residentState: true,
          runIdentity: true,
          childSchedulerSuppression: true
        }
      })
    }
  }
  const data = event('invalid-dates', {
    timestamp: new Date(NaN),
    startedAt: new Date(NaN),
    finishedAt: new Date(NaN)
  })
  const telemetry = questEvent(data, 'completed', {
    sails,
    appId: '7',
    deploymentId: '42'
  })
  assert.equal(telemetry.requestedAt, NOW)
  assert.equal(telemetry.startedAt, null)
  assert.equal(telemetry.finishedAt, NOW)
  const bridge = createQuestRuntime({ sails, appId: '7', deploymentId: '42' })
  bridge.record('completed', data)
  const run = bridge.runs.get(data.runId)
  assert.equal(run.requestedAt, NOW)
  assert.equal(run.startedAt, NOW)
  assert.equal(run.finishedAt, NOW)
})

test('50 near-16 KiB business results split into accepted batches without losing registration or run order', async (t) => {
  const receiver = createReceiver(t)
  const client = await createHook(t)
  const value = 'b'.repeat(16 * 1024 - 100)
  for (let index = 0; index < 50; index++)
    client.sails.emit(
      'quest:job:complete',
      event(`large-${index}`, {
        result: { status: 'available', value, exit: 'noRecords' }
      })
    )
  const deliveries = client.requests.filter(({ body }) => body.metrics.length)
  assert.ok(deliveries.length > 1)
  assert.ok(deliveries.every(({ body }) => body.registration.appId === '7'))
  await receiveAll(receiver, client.requests)
  assert.deepEqual(
    receiver.stored.metrics.map((metric) => metric.attributes.runId),
    Array.from({ length: 50 }, (_, index) => `large-${index}`)
  )
  for (const run of receiver.runs.values()) {
    assert.equal(run.state, 'completed')
    assert.equal(run.result.value, value)
    assert.equal(run.result.exit, 'noRecords')
  }
  assert.equal(receiver.runs.size, 50)
})

test('packetization honors each receiver count limit and includes registration in byte accounting', async (t) => {
  const receiver = createReceiver(t)
  const registration = {
    appId: '7',
    deploymentId: '42',
    hookVersion: 'unit-test',
    protocolVersion: 1
  }
  const input = { registration }
  for (const [kind, limit] of Object.entries(COUNTS))
    input[kind] = Array.from({ length: limit + 1 }, (_, index) => ({
      name: `${kind}-${index}`,
      message: `${kind}-${index}`,
      value: index
    }))
  const wires = [...telemetryPayloads(input)]
  for (const wire of wires) {
    const body = assertBounds(wire)
    assert.deepEqual(body.registration, registration)
    await receiver.receive(wire)
  }
  for (const kind of Object.keys(COUNTS)) {
    assert.deepEqual(
      wires.flatMap((wire) => JSON.parse(wire)[kind]),
      input[kind]
    )
    assert.equal(receiver.stored[kind].length, input[kind].length)
    assert.ok(
      wires.some((wire) => JSON.parse(wire)[kind].length === COUNTS[kind])
    )
  }

  // Sixteen events fit exactly in 512 KiB before registration is added.
  const spans = Array.from({ length: 16 }, () => ({
    name: 'boundary',
    padding: ''
  }))
  const emptyBytes = Buffer.byteLength(
    JSON.stringify({ spans, exceptions: [], metrics: [] })
  )
  const padding = BATCH_BYTES - emptyBytes
  spans.forEach((span, index) => {
    span.padding = 'x'.repeat(
      Math.floor(padding / 16) + (index < padding % 16 ? 1 : 0)
    )
  })
  assert.equal(
    Buffer.byteLength(JSON.stringify({ spans, exceptions: [], metrics: [] })),
    BATCH_BYTES
  )
  const bounded = [
    ...telemetryPayloads({ spans, exceptions: [], metrics: [], registration })
  ]
  assert.equal(bounded.length, 2)
  for (const wire of bounded) {
    assertBounds(wire)
    await receiver.receive(wire)
  }
  assert.deepEqual(
    bounded.flatMap((wire) => JSON.parse(wire).spans),
    spans
  )
})

test('ordinary telemetry is preserved while cyclic and oversized events cannot poison neighboring events', async (t) => {
  const receiver = createReceiver(t)
  const cycle = { name: 'cyclic' }
  cycle.self = cycle
  const dropped = []
  const input = { spans: [], exceptions: [], metrics: [] }
  for (const kind of Object.keys(COUNTS)) {
    const valid = (position) => ({
      name: `ordinary.${kind}.${position}`,
      message: `ordinary ${position}`,
      value: 3.5,
      attributes: { nested: [0, false, null, '雪\n'], position }
    })
    input[kind] = [
      valid('before'),
      cycle,
      { name: 'oversized', padding: 'x'.repeat(EVENT_BYTES) },
      { name: 'bigint', value: 1n },
      valid('after')
    ]
  }
  const wires = [...telemetryPayloads(input, (kind) => dropped.push(kind))]
  for (const wire of wires) {
    assertBounds(wire)
    await receiver.receive(wire)
  }
  for (const kind of Object.keys(COUNTS)) {
    assert.deepEqual(
      wires.flatMap((wire) => JSON.parse(wire)[kind]),
      [input[kind][0], input[kind].at(-1)]
    )
    assert.equal(
      dropped.filter((droppedKind) => droppedKind === kind).length,
      3
    )
    assert.equal(receiver.stored[kind].length, 2)
  }
})

test('escaped log and error tails stay wire-bounded while preserving terminal correlation, business value and redaction', async (t) => {
  const receiver = createReceiver(t)
  const client = await createHook(t)
  const secret = 'fixture-private-value'
  const tail = `${secret} ${'\u0000'.repeat(5000)} final tail 🙂`
  const value = 'business-value:'.padEnd(16000, 'b')
  const failure = new Error(tail)
  failure.stack = `Error: ${tail}\n${'\u0000'.repeat(
    70000
  )} at final-frame.js:1:2`
  failure.diagnostic = `${tail}\n${'\u0000'.repeat(
    70000
  )} diagnostic final frame`
  client.sails.emit(
    'quest:job:error',
    event('escaped-failure', {
      inputs: { apiKey: secret },
      error: failure,
      logs: { stdout: tail, stderr: tail },
      result: { status: 'available', value, exit: 'partialResult' }
    })
  )
  await receiveAll(receiver, client.requests)
  const metric = receiver.stored.metrics[0]
  const run = receiver.runs.get('escaped-failure')
  assert.equal(receiver.stored.metrics.length, 1)
  assert.equal(receiver.stored.exceptions.length, 1)
  assert.equal(run.runtimeId, 'synthetic-runtime')
  assert.equal(run.state, 'failed')
  assert.equal(run.sequence, 2)
  assert.equal(run.result.value, value)
  assert.equal(run.result.exit, 'partialResult')
  assert.equal(run.logsTruncated, true)
  assert.equal(metric.attributes.questRun.logsTruncated, true)
  assert.ok(run.stdout.endsWith('final tail 🙂'))
  assert.ok(run.stderr.endsWith('final tail 🙂'))
  assert.equal(run.stdout.includes('\ufffd'), false)
  assert.match(
    receiver.stored.exceptions[0].stackTrace,
    /truncated telemetry diagnostic/
  )
  assert.ok(
    receiver.stored.exceptions[0].stackTrace.endsWith('at final-frame.js:1:2')
  )
  assert.equal(
    JSON.stringify({
      requests: client.requests.map(({ body }) => body),
      logs: client.logs
    }).includes(secret),
    false
  )
})

test('overlapping failed HTTP sends detach each buffer once and never replay old receipts', async (t) => {
  const receiver = createReceiver(t)
  const client = await createHook(t, { batchSize: 2 })
  for (let index = 0; index < 4; index++)
    client.sails.emit('quest:job:complete', event(`overlap-${index}`))
  const pending = client.requests.filter(({ body }) => body.metrics.length)
  assert.equal(pending.length, 2)
  pending[0].request.emit('error', new Error('Synthetic network failure'))
  pending[1].request.emit('timeout')
  assert.equal(pending[1].request.destroyed, true)
  pending[1].request.emit('error', new Error('Synthetic timeout failure'))
  client.flush()
  client.heartbeat()
  for (let index = 4; index < 6; index++)
    client.sails.emit('quest:job:complete', event(`overlap-${index}`))
  await client.close()
  assert.deepEqual(
    client.requests.flatMap(({ body }) =>
      body.metrics.map((metric) => metric.attributes.runId)
    ),
    Array.from({ length: 6 }, (_, index) => `overlap-${index}`)
  )
  assert.equal(
    client.requests.filter(({ body }) => body.metrics.length).length,
    3
  )
  // Only the final successful attempt reaches storage; failure never becomes
  // a claimed receipt and no registration-only heartbeat replays either batch.
  await receiver.receive(
    client.requests.find(
      ({ body }) => body.metrics[0]?.attributes.runId === 'overlap-4'
    ).wire
  )
  assert.deepEqual([...receiver.runs.keys()], ['overlap-4', 'overlap-5'])
  assert.equal(
    client.logs.some((args) =>
      args.join(' ').includes('Synthetic network failure')
    ),
    false
  )
})

test('last-resort Quest envelopes preserve identity, terminal state and bounded named exit when business data is too large', async (t) => {
  const receiver = createReceiver(t)
  const client = await createHook(t, { batchSize: 1 })
  client.sails.emit(
    'quest:job:complete',
    event('hook-too-large', {
      result: {
        status: 'available',
        value: 'x'.repeat(50000),
        exit: 'noRecords'
      }
    })
  )
  await receiveAll(receiver, client.requests)
  assert.deepEqual(receiver.runs.get('hook-too-large').result, {
    status: 'too_large',
    truncated: true,
    exit: 'noRecords'
  })
  const source = client.requests.flatMap(({ body }) => body.metrics)[0]
  for (const [index, exit] of ['noRecords', 'x'.repeat(129)].entries()) {
    const metric = structuredClone(source)
    const run = metric.attributes.questRun
    metric.attributes.runId = run.runId = `packet-too-large-${index}`
    run.inputs = { large: 'i'.repeat(5000) }
    run.result = { status: 'available', value: 'x'.repeat(50000), exit }
    const original = structuredClone(metric)
    const wires = [...telemetryPayloads({ metrics: [metric] })]
    assert.equal(wires.length, 1)
    assertBounds(wires[0])
    await receiver.receive(wires[0])
    assert.deepEqual(metric, original)
    const delivered = JSON.parse(wires[0]).metrics[0].attributes.questRun
    assert.equal(delivered.runId, run.runId)
    assert.equal(delivered.runtimeId, run.runtimeId)
    assert.equal(delivered.sequence, run.sequence)
    assert.equal(delivered.state, 'completed')
    assert.equal(delivered.inputsTruncated, true)
    assert.equal(delivered.result.status, 'too_large')
    assert.equal(delivered.result.truncated, true)
    assert.equal(delivered.result.exit, index === 0 ? 'noRecords' : undefined)
    assert.equal(receiver.runs.get(run.runId).state, 'completed')
    assert.deepEqual(receiver.runs.get(run.runId).result, delivered.result)
  }
})

test('real ingest rejects the wire types, event sizes, batch bytes and counts the sender must avoid', async (t) => {
  const receiver = createReceiver(t)
  const payload = (overrides) =>
    JSON.stringify({ spans: [], exceptions: [], metrics: [], ...overrides })
  const invalid = [
    { metrics: [{ name: 'quest.job.complete', recordedAt: new Date(NOW) }] },
    { exceptions: [{ occurredAt: new Date(NOW).toISOString() }] },
    { metrics: [{ value: NaN }] },
    { spans: [{ duration: Infinity }] },
    { metrics: [{ name: 42 }] },
    { metrics: [{ name: 'oversized', padding: 'x'.repeat(EVENT_BYTES) }] },
    { registration: { padding: 'x'.repeat(BATCH_BYTES) } },
    ...Object.entries(COUNTS).map(([kind, count]) => ({
      [kind]: Array.from({ length: count + 1 }, () => ({}))
    }))
  ]
  for (const input of invalid)
    await assert.rejects(receiver.receive(payload(input)), (error) =>
      Boolean(error.badRequest)
    )
  await assert.rejects(
    receiver.receive(payload({}), ''),
    (error) => error === 'unauthorized'
  )
  assert.deepEqual(receiver.stored, { spans: [], exceptions: [], metrics: [] })
  assert.equal(receiver.runs.size, 0)
  assert.equal(
    receiver.budgetQueries.filter(({ sql }) =>
      sql.includes('rejected_requests=rejected_requests+1')
    ).length,
    invalid.length
  )
})
