const assert = require('node:assert/strict')
const fs = require('node:fs')
const vm = require('node:vm')
const { test } = require('sounding')
const ledger = require('../../../api/lib/quest-run-ledger')

const now = 1800000000000
const scope = { environmentId: 'env-1', appId: 'app-1' }
const receipt = (extra = {}) => ({
  id: 1,
  environment: scope.environmentId,
  app: scope.appId,
  runId: 'run-1',
  runtimeId: 'runtime-1',
  deploymentId: 'deployment-1',
  jobName: 'synthetic',
  state: 'running',
  sequence: 1,
  requestedAt: now - 100,
  startedAt: now - 90,
  finishedAt: null,
  duration: null,
  exitCode: null,
  signal: null,
  updatedAt: now - 50,
  result: { status: 'unavailable' },
  resultStatus: 'unavailable',
  inputs: { value: 0 },
  stdout: '',
  stderr: '',
  error: null,
  ...extra
})
const copy = (value) => (value == null ? value : structuredClone(value))
function matches(row, where) {
  return Object.entries(where).every(([key, value]) => {
    if (value && typeof value === 'object')
      return Object.entries(value).every(
        ([operator, expected]) =>
          ({
            in: () => expected.includes(row[key]),
            nin: () => row[key] != null && !expected.includes(row[key]),
            '<': () => row[key] < expected,
            '>=': () => row[key] >= expected
          }[operator]?.() ?? false)
      )
    return row[key] === value
  })
}
function memoryModel(rows) {
  const queries = [],
    projections = [],
    updates = []
  let beforeWrite = null
  return {
    rows,
    queries,
    projections,
    updates,
    race(callback) {
      beforeWrite = callback
    },
    findOne(where) {
      const read = () => copy(rows.find((row) => matches(row, where)))
      return {
        then(resolve, reject) {
          return Promise.resolve(read()).then(resolve, reject)
        },
        async select(fields) {
          projections.push(fields)
          const row = read()
          return row && Object.fromEntries(fields.map((key) => [key, row[key]]))
        }
      }
    },
    find(where) {
      queries.push(where)
      let fields
      return {
        select(value) {
          fields = value
          projections.push(value)
          return this
        },
        sort() {
          return this
        },
        async limit(limit) {
          assert.equal(limit, 100)
          return rows
            .filter((row) => matches(row, where))
            .slice(0, limit)
            .map((row) =>
              Object.fromEntries(fields.map((key) => [key, row[key]]))
            )
        }
      }
    },
    update(where) {
      return this.updateOne(where, true)
    },
    updateOne(where, many = false) {
      return {
        async set(values) {
          if (beforeWrite) {
            const callback = beforeWrite
            beforeWrite = null
            callback(rows)
          }
          updates.push({ where, values })
          const found = rows.filter((row) => matches(row, where))
          const selected = many ? found : found.slice(0, 1)
          selected.forEach((row) => Object.assign(row, values))
          return many ? copy(selected) : copy(selected[0])
        }
      }
    }
  }
}

test('Quest unavailable evidence marks scoped active receipts in bounded batches without inventing execution facts', async () => {
  for (const [reason, phrase] of [
    ['app_stopped', /app is stopped/],
    ['resident_unavailable', /could not be read/]
  ]) {
    const active = Array.from({ length: 101 }, (_, id) =>
      receipt({ id: id + 1, runId: `run-${id}` })
    )
    const preserved = [
      receipt({
        id: 102,
        runId: 'terminal',
        state: 'completed',
        result: { status: 'available', value: false }
      }),
      receipt({ id: 103, runId: 'other-app', app: 'app-2' }),
      receipt({ id: 104, runId: 'other-env', environment: 'env-2' }),
      receipt({ id: 105, runId: 'newer', updatedAt: now }),
      receipt({ id: 106, runId: 'unknown-runtime', runtimeId: null })
    ]
    const before = copy(preserved)
    const original = copy(active[0])
    const model = memoryModel([...active, ...preserved])
    assert.deepEqual(
      await ledger.reconcileUnavailableRuns(
        scope,
        { reason, before: now },
        { model, now }
      ),
      { checked: 100, hasMore: true }
    )
    assert.deepEqual(
      await ledger.reconcileUnavailableRuns(
        scope,
        { reason, before: now },
        { model, now }
      ),
      { checked: 1, hasMore: false }
    )
    assert.deepEqual(preserved, before)
    assert.ok(
      model.projections.every((fields) => JSON.stringify(fields) === '["id"]')
    )
    for (const row of active) {
      assert.equal(row.state, 'unconfirmed')
      assert.match(row.error, phrase)
      assert.equal(row.updatedAt, now)
    }
    for (const field of [
      'sequence',
      'requestedAt',
      'startedAt',
      'finishedAt',
      'duration',
      'exitCode',
      'signal',
      'result',
      'inputs'
    ])
      assert.deepEqual(active[0][field], original[field], field)
  }
})

test('Quest bounded resident absence is evidence loss only and excludes observed, newer, other-runtime and other-deployment runs', async () => {
  const rows = [
    receipt(),
    receipt({ id: 2, runId: 'retained' }),
    receipt({ id: 3, runId: 'new', updatedAt: now }),
    receipt({ id: 4, runId: 'foreign-runtime', runtimeId: 'runtime-2' }),
    receipt({
      id: 5,
      runId: 'foreign-deployment',
      deploymentId: 'deployment-2'
    })
  ]
  const model = memoryModel(rows)
  await ledger.reconcileUnavailableRuns(
    scope,
    {
      reason: 'receipt_not_retained',
      runtimeId: 'runtime-1',
      deploymentId: 'deployment-1',
      retainedRunIds: ['retained'],
      before: now
    },
    { model, now }
  )
  assert.equal(rows[0].state, 'unconfirmed')
  assert.match(rows[0].error, /no longer retains evidence/)
  assert.match(rows[0].error, /does not establish/)
  assert.ok(rows.slice(1).every((row) => row.state === 'running'))
  model.race((current) => {
    current[1].state = 'completed'
    current[1].sequence = 2
  })
  await ledger.reconcileUnavailableRuns(
    scope,
    { reason: 'app_stopped', before: now },
    { model, now }
  )
  assert.equal(
    rows[1].state,
    'completed',
    'A terminal delivery wins a simultaneous uncertainty update'
  )
})

test('Quest only current resident evidence restores same-sequence Running; later canonical terminal telemetry remains authoritative', async () => {
  const run = receipt({
    state: 'unconfirmed',
    error: 'Evidence unavailable',
    updatedAt: now - 1
  })
  const model = memoryModel([run])
  const event = { ...copy(run), state: 'running', error: null }
  await ledger.ingest(event, scope, { model, now })
  assert.equal(
    run.state,
    'unconfirmed',
    'Repeated telemetry is not a current observation'
  )
  await assert.rejects(
    ledger.restoreResidentRunning({ ...event, runtimeId: 'foreign' }, scope, {
      model,
      now
    }),
    { code: 'QUEST_RUN_CONFLICT' }
  )
  await ledger.restoreResidentRunning(event, scope, {
    model,
    now,
    observedBefore: now - 1
  })
  assert.equal(
    run.state,
    'unconfirmed',
    'An older inspection cannot undo a newer observation'
  )
  await ledger.restoreResidentRunning(event, scope, {
    model,
    now,
    observedBefore: now
  })
  assert.equal(run.state, 'running')
  assert.equal(run.updatedAt, now)
  assert.equal(run.sequence, 1)
  assert.equal(run.error, null)
  assert.ok(
    model.projections.every(
      (fields) => !fields.includes('result') && !fields.includes('inputs')
    )
  )
  await ledger.reconcileUnavailableRuns(
    scope,
    { reason: 'resident_unavailable', before: now + 1 },
    { model, now: now + 1 }
  )
  await ledger.ingest(
    {
      ...event,
      state: 'completed',
      sequence: 2,
      exitCode: 0,
      finishedAt: now + 2,
      result: { status: 'available', value: false }
    },
    scope,
    { model, now: now + 2 }
  )
  assert.equal(run.state, 'completed')
  assert.equal(run.result.value, false)
  assert.equal(run.exitCode, 0)
  await ledger.restoreResidentRunning(event, scope, { model, now: now + 3 })
  assert.equal(run.state, 'completed')
})

test('Quest resident recovery compare-and-set preserves a racing terminal outcome', async () => {
  const run = receipt({ state: 'unconfirmed', error: 'Evidence unavailable' })
  const model = memoryModel([run])
  model.race(([current]) =>
    Object.assign(current, {
      state: 'completed',
      sequence: 2,
      updatedAt: now,
      result: { status: 'available', value: 'retained result' },
      stdout: 'richer logs'
    })
  )
  await ledger.restoreResidentRunning(
    { ...copy(run), state: 'running' },
    scope,
    { model, now }
  )
  assert.equal(run.state, 'completed')
  assert.equal(run.result.value, 'retained result')
  assert.equal(run.stdout, 'richer logs')
})

test('Quest UI accepts newer resident recovery but rejects delayed uncertainty and terminal regressions', async () => {
  const { mergeQuestRuns } = await import(
    '../../../assets/js/lib/questWorkspace.mjs'
  )
  const unknown = receipt({ state: 'unconfirmed', updatedAt: now })
  for (const updatedAt of [undefined, now - 1, now])
    assert.equal(
      mergeQuestRuns(
        [unknown],
        [{ ...unknown, state: 'running', updatedAt }]
      )[0].state,
      'unconfirmed'
    )
  const recovered = mergeQuestRuns(
    [unknown],
    [{ ...unknown, state: 'running', updatedAt: now + 1 }]
  )[0]
  assert.equal(recovered.state, 'running')
  assert.equal(mergeQuestRuns([recovered], [unknown])[0].state, 'running')
  assert.equal(
    mergeQuestRuns(
      [recovered],
      [{ ...unknown, updatedAt: recovered.updatedAt }]
    )[0].state,
    'running'
  )
  assert.equal(
    mergeQuestRuns([recovered], [{ ...recovered }])[0].state,
    'running'
  )
  for (const state of [
    'completed',
    'failed',
    'skipped',
    'cancelled',
    'timed_out',
    'interrupted'
  ])
    for (const next of ['running', 'unconfirmed', 'failed'])
      assert.equal(
        mergeQuestRuns(
          [{ ...unknown, state }],
          [{ ...recovered, state: next }]
        )[0].state,
        state
      )
})

test('Quest persistence and verified enrichment preserve bounded boolean result truncation without replacing terminal evidence', async () => {
  for (const value of [false, 'true', { unexpected: 'metadata' }, undefined])
    assert.equal(
      Object.hasOwn(
        ledger.resultEnvelope({
          status: 'available',
          value: 0,
          truncated: value
        }),
        'truncated'
      ),
      false
    )
  const partial = {
    status: 'available',
    value: { rows: [{ id: 1 }] },
    truncated: true
  }
  const run = receipt()
  const model = memoryModel([run])
  await ledger.ingest(
    { runId: run.runId, state: 'completed', sequence: 2, result: partial },
    scope,
    { model, now }
  )
  assert.deepEqual(
    (await ledger.getRun(scope, run.runId, { model, now })).result,
    partial
  )
  await ledger.ingest(
    {
      runId: run.runId,
      state: 'completed',
      sequence: 3,
      result: { status: 'available', value: 'contradictory' }
    },
    scope,
    { model, now }
  )
  assert.deepEqual(
    run.result,
    partial,
    'Telemetry cannot replace a terminal result'
  )
  const missing = receipt({
    runId: 'missing-result',
    state: 'completed',
    sequence: 2,
    resultStatus: 'too_large',
    result: { status: 'too_large' }
  })
  const residentModel = memoryModel([missing])
  await ledger.enrichResidentReceipt(
    { ...copy(missing), result: partial },
    scope,
    { model: residentModel, now }
  )
  assert.deepEqual(
    (await ledger.getRun(scope, missing.runId, { model: residentModel, now }))
      .result,
    partial
  )
  await ledger.enrichResidentReceipt(
    {
      ...copy(missing),
      result: { status: 'available', value: 'contradictory', truncated: false }
    },
    scope,
    { model: residentModel, now: now + 1 }
  )
  assert.deepEqual(
    missing.result,
    partial,
    'A retained available result is not guessed to be replaceable'
  )
})

test('Quest workspace distinguishes stopped state and transport failure from payload reconciliation failure', async () => {
  const source = fs.readFileSync(
    require.resolve('../../../api/lib/quest-workspace'),
    'utf8'
  )
  for (const mode of ['stopped', 'transport', 'payload', 'initial']) {
    const observations = [],
      requests = []
    const context = {
      app: {
        id: 'app-1',
        currentDeployment: 'deployment-1',
        status: mode === 'stopped' ? 'stopped' : 'running',
        containerName: 'synthetic'
      },
      environment: {
        id: 'env-1',
        features: { 'sails-quest': { scripts: [] } }
      },
      user: { teamRole: 'owner' }
    }
    const mockedLedger = {
      async listRuns() {
        return { runs: [], legacyEvents: [], nextCursor: null }
      },
      async reconcileUnavailableRuns(_scope, observation) {
        observations.push(observation)
        return { checked: 0, hasMore: false }
      },
      async reconcileRuntimeLoss() {
        return { checked: 0, hasMore: false }
      },
      async getReceiptMeta() {
        return null
      }
    }
    const module = { exports: {} }
    vm.runInNewContext(source, {
      module,
      require(name) {
        if (name === './quest-run-ledger') return mockedLedger
        return {
          async request(_app, command) {
            requests.push(command)
            if (mode === 'transport' || command === 'run')
              throw new Error('Synthetic evidence read failure')
            return {
              version: 1,
              runtimeId: 'runtime-1',
              observedAt: now,
              jobs: [],
              runs: [receipt()]
            }
          }
        }
      }
    })
    const result =
      mode === 'initial'
        ? await module.exports.initialSnapshot(context)
        : await module.exports.snapshot(context, { fresh: true })
    if (mode === 'initial') {
      assert.equal(observations.length, 0)
      assert.equal(requests.length, 0)
    } else if (mode === 'payload') {
      assert.equal(result.mode, 'resident')
      assert.deepEqual(
        observations.map((item) => item.reason),
        ['receipt_not_retained']
      )
    } else {
      assert.equal(
        observations[0].reason,
        mode === 'stopped' ? 'app_stopped' : 'resident_unavailable'
      )
      assert.equal(requests.length, mode === 'stopped' ? 0 : 1)
    }
  }
})
