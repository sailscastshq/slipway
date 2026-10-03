const assert = require('node:assert/strict')
const { test } = require('sounding')
const ledger = require('../../../api/lib/quest-run-ledger')

const now = 1700000000000
const scope = { environmentId: '1', appId: '2' }
const receipt = (extra = {}) => ({
  environment: '1',
  app: '2',
  runId: 'revision-receipt',
  runtimeId: 'resident-a',
  deploymentId: 'deployment-a',
  jobName: 'report',
  requestedAt: now - 100,
  startedAt: now - 90,
  finishedAt: now - 10,
  updatedAt: now,
  state: 'completed',
  sequence: 2,
  inputs: {},
  inputHash: 'retained-admission-hash',
  actor: 'Synthetic operator',
  resultStatus: 'available',
  result: { status: 'available', value: 0 },
  stdout: 'tail',
  stderr: '',
  logsAvailable: true,
  logsTruncated: true,
  ...extra
})

test('Quest enrichment advances bounded evidence revision even within one millisecond or after a clock rollback', async () => {
  let current = receipt()
  const before = structuredClone(current)
  let writes = 0
  const model = {
    async findOne() {
      return structuredClone(current)
    },
    updateOne(criteria) {
      assert.equal(criteria.environment, scope.environmentId)
      assert.equal(criteria.app, scope.appId)
      assert.equal(criteria.updatedAt, current.updatedAt)
      return {
        async set(values) {
          writes++
          current = { ...current, ...values }
          return structuredClone(current)
        }
      }
    }
  }
  const event = {
    ...current,
    inputs: { count: 0, enabled: false, payload: null },
    stdout: 'complete output with tail',
    logsTruncated: false
  }
  const enriched = await ledger.enrichResidentReceipt(event, scope, {
    model,
    now: now - 50
  })
  assert.equal(enriched.updatedAt, now + 1)
  assert.deepEqual(enriched.inputs, event.inputs)
  assert.equal(enriched.stdout, event.stdout)
  assert.equal(enriched.logsTruncated, false)
  for (const field of [
    'state',
    'sequence',
    'resultStatus',
    'result',
    'actor',
    'inputHash',
    'requestedAt',
    'startedAt',
    'finishedAt'
  ])
    assert.deepEqual(enriched[field], before[field], field)
  const summary = ledger.summary(enriched)
  assert.equal(summary.updatedAt, now + 1)
  for (const field of ['inputs', 'result', 'stdout', 'stderr', 'error'])
    assert.equal(Object.hasOwn(summary, field), false)
  const unchanged = await ledger.enrichResidentReceipt(event, scope, {
    model,
    now: now + 20
  })
  assert.equal(unchanged.updatedAt, now + 1)
  assert.equal(writes, 1)
})

test('Quest input-only enrichment retries the evidence CAS without overwriting a concurrent winner', async () => {
  let current = receipt({ stdout: '', logsTruncated: false })
  let attempts = 0
  const model = {
    async findOne() {
      return structuredClone(current)
    },
    updateOne(criteria) {
      assert.equal(criteria.updatedAt, now)
      return {
        async set(values) {
          attempts++
          assert.equal(values.updatedAt, now + 1)
          current = {
            ...current,
            inputs: { winner: true },
            updatedAt: now + 1
          }
          return null
        }
      }
    }
  }
  const result = await ledger.enrichResidentReceipt(
    { ...current, inputs: { loser: true } },
    scope,
    { model, now }
  )
  assert.equal(attempts, 1)
  assert.deepEqual(result.inputs, { winner: true })
  assert.equal(result.updatedAt, now + 1)
})

test('Quest unchanged bounded log tails do not advance the evidence revision', async () => {
  const current = receipt()
  const result = await ledger.enrichResidentReceipt(current, scope, {
    now: now + 20,
    model: {
      async findOne() {
        return structuredClone(current)
      },
      updateOne() {
        assert.fail('Identical truncated logs are not new evidence')
      }
    }
  })
  assert.equal(result.updatedAt, now)
})

test('Quest selected receipt summary reads scope and revision without projecting payload bodies', async () => {
  let where, fields
  const current = receipt({ inputs: { privateBody: 'not a summary' } })
  const result = await ledger.getRunSummary(scope, current.runId, {
    now,
    model: {
      findOne(criteria) {
        where = criteria
        return {
          async select(projection) {
            fields = projection
            return Object.fromEntries(
              projection.map((key) => [key, current[key]])
            )
          }
        }
      }
    }
  })
  assert.equal(where.app, scope.appId)
  assert.equal(where.environment, scope.environmentId)
  assert.equal(where.runId, current.runId)
  assert.equal(where.requestedAt['>='], now - ledger.RETENTION_MS)
  assert.ok(fields.includes('updatedAt'))
  assert.equal(result.updatedAt, now)
  for (const field of ['inputs', 'result', 'stdout', 'stderr', 'error']) {
    assert.equal(fields.includes(field), false)
    assert.equal(Object.hasOwn(result, field), false)
  }
})
