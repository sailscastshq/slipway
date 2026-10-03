const assert = require('node:assert/strict')
const crypto = require('node:crypto')
const { test } = require('sounding')
const ledger = require('../../../api/lib/quest-run-ledger')

test('Quest redacts nested structured payloads and diagnostic secrets before storing', () => {
  const options = { environment: { DATABASE_PASSWORD: 'private-secret-value' } }
  const value = ledger.sanitizeValue(
    {
      password: 'private',
      nested: [
        { ok: '\u001b[31mhello\u001b[0m private-secret-value Bearer xyz' }
      ],
      credential: 'secret'
    },
    options
  )
  assert.equal(value.password, '<redacted>')
  assert.equal(value.credential, '<redacted>')
  assert.equal(value.nested[0].ok, 'hello <redacted> Bearer <redacted>')
  assert.equal(
    ledger.boundedText('TOKEN=visible', 100).value,
    'TOKEN=<redacted>'
  )
})

test('Quest result envelopes preserve falsy values and distinguish serialization outcomes', () => {
  for (const value of [
    null,
    false,
    0,
    '',
    '  exact  ',
    '\n\t',
    [],
    { data: 'ok' }
  ]) {
    assert.deepEqual(
      JSON.parse(
        JSON.stringify(ledger.resultEnvelope({ status: 'available', value }))
      ),
      { status: 'available', value }
    )
  }
  assert.equal(
    ledger.resultEnvelope({ status: 'available', value: undefined }).status,
    'undefined'
  )
  assert.equal(
    ledger.resultEnvelope({ status: 'available', value: 12n }).status,
    'unsupported'
  )
  assert.equal(
    ledger.resultEnvelope({ status: 'available', value: new Date() }).status,
    'unsupported'
  )
  const cycle = {}
  cycle.self = cycle
  assert.equal(
    ledger.resultEnvelope({ status: 'available', value: cycle }).status,
    'serialization_error'
  )
  const accessor = Object.defineProperty({}, 'unsafe', {
    enumerable: true,
    get() {
      throw new Error('must not execute')
    }
  })
  assert.equal(
    ledger.resultEnvelope({ status: 'available', value: accessor }).status,
    'serialization_error'
  )
  assert.deepEqual(
    ledger.resultEnvelope({ status: 'available', value: '💛'.repeat(40000) }),
    { status: 'too_large', truncated: true }
  )
  let deep = {}
  for (let i = 0; i < 20; i++) deep = { child: deep }
  assert.equal(
    ledger.resultEnvelope({ status: 'available', value: deep }).status,
    'too_large'
  )
  assert.equal(
    ledger.resultEnvelope({ status: 'available', value: Array(5000).fill(1) })
      .status,
    'too_large'
  )
  assert.deepEqual(
    ledger.resultEnvelope({ status: 'unavailable', value: 'not a result' }),
    { status: 'unavailable' }
  )
})

test('Quest log bounds count UTF-8 bytes without broken codepoints', () => {
  for (let budget = 1; budget < 10; budget++) {
    const bounded = ledger.boundedText('🙂'.repeat(20), budget)
    assert.equal(bounded.truncated, true)
    assert.ok(Buffer.byteLength(bounded.value) <= budget)
    assert.equal(bounded.value.includes('\ufffd'), false)
  }
})

test('Quest job-filtered summary reads project fields without loading result or log bodies', async () => {
  const queries = [],
    selects = [],
    native = []
  const model = {
    find(where) {
      queries.push(where)
      return {
        select(fields) {
          selects.push(fields)
          return this
        },
        sort() {
          return this
        },
        limit() {
          return Promise.resolve([])
        }
      }
    }
  }
  const metrics = {
    ...model,
    getDatastore() {
      return {
        async sendNativeQuery(sql, values) {
          native.push({ sql, values })
          return { rows: [] }
        }
      }
    }
  }
  const job = "ops/report's-history"
  await ledger.listRuns(
    { environmentId: 1, appId: 2 },
    { job },
    { model, metrics, now: 1000000000 }
  )
  assert.equal(queries.filter((where) => where.jobName === job).length, 2)
  assert.ok(
    selects.every(
      (fields) =>
        !fields.some((field) =>
          ['inputs', 'result', 'stdout', 'stderr', 'attributes'].includes(field)
        )
    )
  )
  assert.equal(native.length, 1)
  assert.ok(
    native[0].sql.includes(
      "json_extract(CASE WHEN json_valid(attributes) THEN attributes ELSE '{}' END, '$.jobName') = ?"
    )
  )
  assert.equal(native[0].sql.includes(job), false)
  assert.ok(native[0].values.includes(job))
  assert.equal(/stdout|stderr|\$\.payload/.test(native[0].sql), false)
})

test('Quest receipt reconciliation reads only revision and runtime metadata', async () => {
  let criteria, selected
  const model = {
    findOne(where) {
      criteria = where
      return {
        async select(fields) {
          selected = fields
          return {
            id: 9,
            sequence: 3,
            runtimeId: 'runtime-a',
            state: 'running'
          }
        }
      }
    }
  }
  const result = await ledger.getReceiptMeta(
    { environmentId: 1, appId: 2 },
    'run-a',
    { model, now: 1000000000 }
  )
  assert.deepEqual(selected, ['sequence', 'runtimeId', 'state'])
  assert.deepEqual(result, {
    sequence: 3,
    runtimeId: 'runtime-a',
    state: 'running'
  })
  assert.equal(criteria.environment, '1')
  assert.equal(criteria.app, '2')
  assert.equal(criteria.runId, 'run-a')
  assert.equal(criteria.requestedAt['>='], 1000000000 - ledger.RETENTION_MS)
})

test('Quest resident enrichment never downgrades a concurrently enriched terminal receipt', async () => {
  const scope = { environmentId: '1', appId: '2' }
  const now = Date.now()
  let current = {
    environment: '1',
    app: '2',
    runId: 'receipt',
    runtimeId: 'resident-a',
    deploymentId: 'deployment-a',
    jobName: 'report',
    requestedAt: now,
    startedAt: now,
    finishedAt: now + 1,
    state: 'completed',
    sequence: 2,
    inputs: { count: 0 },
    inputHash: 'unchanged-admission-hash',
    resultStatus: 'too_large',
    result: { status: 'too_large' },
    stdout: 'tail',
    stderr: '',
    logsAvailable: true,
    logsTruncated: true
  }
  let updates = 0
  const model = {
    async findOne() {
      return { ...current }
    },
    updateOne(criteria) {
      assert.equal(criteria.state, 'completed')
      assert.equal(criteria.sequence, 2)
      assert.equal(criteria.stdout, 'tail')
      return {
        async set(values) {
          assert.deepEqual(Object.keys(values).sort(), [
            'logsAvailable',
            'logsTruncated',
            'result',
            'resultStatus',
            'stderr',
            'stdout',
            'updatedAt'
          ])
          updates++
          current = {
            ...current,
            resultStatus: 'available',
            result: { status: 'available', value: { count: 0 } },
            stdout: 'complete output with tail',
            logsTruncated: false
          }
          return null // Another resident reconciliation won the compare-and-set.
        }
      }
    }
  }
  const returned = await ledger.enrichResidentReceipt(
    {
      ...current,
      result: { status: 'available', value: 'less useful' },
      stdout: 'output with tail',
      logsTruncated: true
    },
    scope,
    { model, now }
  )
  assert.equal(updates, 1)
  assert.equal(returned.stdout, 'complete output with tail')
  assert.deepEqual(returned.result.value, { count: 0 })
  assert.equal(returned.sequence, 2)
  assert.equal(returned.inputHash, 'unchanged-admission-hash')
  assert.equal(returned.finishedAt, now + 1)
})

test('Quest receipt admission tolerates a same-run delivery race without weakening request-key admission', async () => {
  const scope = { environmentId: '1', appId: '2' }
  const event = {
    runId: 'racing-receipt',
    runtimeId: 'resident-a',
    deploymentId: 'deployment-a',
    jobName: 'report',
    inputs: { payload: 'resident value omitted by telemetry' }
  }
  const winner = {
    ...event,
    app: '2',
    environment: '1',
    inputHash: 'telemetry-evidence-hash',
    inputs: {}
  }
  let reads = 0
  const model = {
    async findOne() {
      return ++reads > 2 ? winner : null
    },
    create() {
      return {
        async fetch() {
          throw Object.assign(new Error('Concurrent delivery'), {
            code: 'E_UNIQUE'
          })
        }
      }
    }
  }
  assert.equal(await ledger.admitReceipt(event, scope, { model }), winner)
  assert.equal(winner.inputHash, 'telemetry-evidence-hash')
  await assert.rejects(ledger.admit({ ...event, ...scope }, { model }), {
    code: 'QUEST_RUN_CONFLICT'
  })
})

test('Quest receipt admission rechecks exact run and runtime identity after inner lookup or unique races', async () => {
  const scope = { environmentId: '1', appId: '2' }
  const event = {
    runId: 'expected-receipt',
    runtimeId: 'expected-runtime',
    deploymentId: 'deployment-a',
    jobName: 'report',
    requestId: 'same-request-key',
    inputs: {}
  }
  for (const collision of [
    { runtimeId: 'foreign-runtime' },
    { runId: 'different-receipt' }
  ])
    for (const arrival of ['inner-lookup', 'unique-race']) {
      const winner = {
        ...event,
        ...collision,
        app: '2',
        environment: '1',
        inputHash: crypto.createHash('sha256').update('{}').digest('hex')
      }
      let reads = 0
      const model = {
        async findOne() {
          return ++reads > (arrival === 'inner-lookup' ? 1 : 2) ? winner : null
        },
        create() {
          assert.equal(arrival, 'unique-race')
          return {
            async fetch() {
              throw Object.assign(new Error('Concurrent receipt'), {
                code: 'E_UNIQUE'
              })
            }
          }
        }
      }
      await assert.rejects(ledger.admitReceipt(event, scope, { model }), {
        code: 'QUEST_RUN_CONFLICT'
      })
    }
})

test('Quest runtime-loss reconciliation selects only bounded identifiers and preserves execution evidence', async () => {
  const observed = {}
  const model = {
    find(where) {
      observed.where = where
      return {
        select(fields) {
          observed.fields = fields
          return this
        },
        sort(order) {
          observed.order = order
          return this
        },
        async limit(limit) {
          observed.limit = limit
          return [{ id: 3 }, { id: 4 }]
        }
      }
    },
    update(where) {
      observed.updateWhere = where
      return {
        async set(values) {
          observed.values = values
        }
      }
    }
  }
  assert.deepEqual(
    await ledger.reconcileRuntimeLoss(
      { environmentId: 1, appId: 2 },
      'current-runtime',
      { model, now: 1000000000 }
    ),
    { checked: 2, hasMore: false }
  )
  assert.deepEqual(observed.fields, ['id'])
  assert.equal(observed.limit, 100)
  assert.equal(observed.order, 'id ASC')
  assert.deepEqual(observed.updateWhere, {
    ...observed.where,
    id: { in: [3, 4] }
  })
  assert.equal(observed.where.environment, '1')
  assert.equal(observed.where.app, '2')
  assert.deepEqual(observed.where.runtimeId, { nin: ['current-runtime', ''] })
  assert.equal(
    observed.where.requestedAt['>='],
    1000000000 - ledger.RETENTION_MS
  )
  assert.deepEqual(Object.keys(observed.values).sort(), [
    'error',
    'state',
    'updatedAt'
  ])
  assert.equal(observed.values.state, 'unconfirmed')
  assert.equal(observed.where.updatedAt['<'], 1000000000)
  assert.equal(observed.values.updatedAt, 1000000000)
})
