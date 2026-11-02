const { test } = require('node:test')
const assert = require('node:assert/strict')
const transaction = require('../../../api/lib/deployment-datastore-transaction')
function callbackDatastore(transaction) {
  return {
    transaction(work, done) {
      Promise.resolve()
        .then(() => transaction(work))
        .then((value) => done(null, value), done)
    }
  }
}

const busy = (code = 'SQLITE_BUSY') =>
  Object.assign(new Error('database is locked'), { code })

function rolledBackDatastore(onAttempt) {
  return callbackDatastore(async (work) => {
    await onAttempt?.()
    return work({})
  })
}

test('deployment DB recovery retries rollback-confirmed snapshots only, preserving external effects', async () => {
  let attempts = 0,
    starts = 0
  starts++ // external operation completes once, outside the DB-only callback
  const result = await transaction(
    async () => {
      if (++attempts < 3) throw busy('SQLITE_BUSY_SNAPSHOT')
      return 'persisted'
    },
    { datastore: rolledBackDatastore(), wait: async () => {} }
  )
  assert.equal(result, 'persisted')
  assert.equal(attempts, 3)
  assert.equal(starts, 1)
})

test('deployment DB recovery preserves exhausted original error and stops at deadline', async () => {
  const error = busy()
  let attempts = 0,
    clock = 0
  await assert.rejects(
    transaction(
      async () => {
        attempts++
        throw error
      },
      {
        datastore: rolledBackDatastore(),
        now: () => clock,
        deadline: 200,
        wait: async (ms) => {
          clock += ms
        }
      }
    ),
    (e) => e === error
  )
  assert.equal(attempts, 3)
  assert.equal(clock, 150)
  attempts = 0
  await assert.rejects(
    transaction(
      async () => {
        attempts++
        throw error
      },
      {
        datastore: rolledBackDatastore(),
        wait: async () => {}
      }
    ),
    (e) => e === error
  )
  assert.equal(attempts, 5)
})

for (const outcome of ['commit', 'rollback', 'release']) {
  test(`deployment DB recovery never replays an uncertain ${outcome}`, async () => {
    let calls = 0
    const original = busy()
    const reported = Object.assign(new Error(`${outcome} failed`), {
      raw: original
    })
    const datastore = callbackDatastore(async (work) => {
      try {
        await work({})
      } catch (e) {
        assert.equal(e, original)
      }
      throw reported
    })
    await assert.rejects(
      transaction(
        async () => {
          calls++
          if (outcome === 'rollback') throw original
        },
        { datastore, wait: async () => {} }
      ),
      (e) => e === reported
    )
    assert.equal(calls, 1)
  })
}

test('non-contention errors, admission guards and cancellation are not retried away', async () => {
  for (const code of [
    'DEPLOYMENT_LEASE_LOST',
    'DEPLOYMENT_CANCELLED',
    'E_UNIQUE',
    'SQLITE_READONLY'
  ]) {
    const error = Object.assign(new Error(code), { code })
    let calls = 0
    await assert.rejects(
      transaction(
        async () => {
          calls++
          throw error
        },
        {
          datastore: rolledBackDatastore(),
          wait: async () => {}
        }
      ),
      (e) => e === error
    )
    assert.equal(calls, 1)
  }
  const controller = new AbortController()
  let calls = 0
  await assert.rejects(
    transaction(
      async () => {
        calls++
        throw busy()
      },
      {
        datastore: rolledBackDatastore(),
        signal: controller.signal,
        wait: async () => controller.abort()
      }
    ),
    { name: 'AbortError' }
  )
  assert.equal(calls, 1)
})

test('a busy begin can retry without entering the transaction body', async () => {
  let begins = 0,
    calls = 0
  const datastore = callbackDatastore(async (work) => {
    if (++begins === 1) throw busy()
    return work({})
  })
  await transaction(async () => calls++, { datastore, wait: async () => {} })
  assert.equal(begins, 2)
  assert.equal(calls, 1)
})
