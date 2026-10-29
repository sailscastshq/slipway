const { test } = require('node:test')
const assert = require('node:assert/strict')
const retry = require('../../../api/lib/ci-datastore-retry')
const busy = () =>
  Object.assign(new Error('adapter wrapper'), {
    raw: { code: 'E_BUSY', sqliteCode: 'SQLITE_BUSY' }
  })
test('observation tolerates bounded transient contention and returns once; no executor is replayed', async () => {
  let attempts = 0
  const delays = []
  const result = await retry(
    async () => {
      if (++attempts < 3) throw busy()
      return 'observed'
    },
    { wait: async (ms) => delays.push(ms) }
  )
  assert.equal(result, 'observed')
  assert.equal(attempts, 3)
  assert.deepEqual(delays, [50, 100])
})
test('persistent contention exhausts five attempts and preserves the error', async () => {
  let attempts = 0
  const error = busy()
  await assert.rejects(
    retry(
      async () => {
        attempts++
        throw error
      },
      { wait: async () => {} }
    ),
    (e) => e === error
  )
  assert.equal(attempts, 5)
})
test('cancellation, lease loss, unrelated busy guards and deadlines cannot be retried away', async () => {
  for (const code of [
    'DEPLOYMENT_LEASE_LOST',
    'DEPLOYMENT_CANCELLED',
    'E_IMAGE_OPERATIONS_BUSY',
    'SQLITE_READONLY'
  ]) {
    let count = 0
    const error = Object.assign(new Error(code), { code })
    await assert.rejects(
      retry(async () => {
        count++
        throw error
      }),
      (e) => e === error
    )
    assert.equal(count, 1)
  }
  const controller = new AbortController()
  let count = 0
  await assert.rejects(
    retry(
      async () => {
        count++
        throw busy()
      },
      { signal: controller.signal, wait: async () => controller.abort() }
    ),
    { name: 'AbortError' }
  )
  assert.equal(count, 1)
  await assert.rejects(
    retry(
      async () => {
        throw Error('must not run')
      },
      { now: () => 100, deadline: 100 }
    ),
    /deadline/
  )
  let clock = 0
  await assert.rejects(
    retry(
      async () => {
        throw busy()
      },
      {
        now: () => clock,
        deadline: 100,
        wait: async (ms) => {
          clock += ms
        }
      }
    ),
    /adapter wrapper/
  )
  assert.equal(clock, 50)
})
