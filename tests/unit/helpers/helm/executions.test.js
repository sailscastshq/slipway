const { test } = require('sounding')
const { EventEmitter } = require('node:events')

const helmExecutions = require('../../../../api/lib/helm-executions')

test('Helm execution cancellation is scoped to its owning user', async ({
  expect
}) => {
  const execution = helmExecutions.register({
    executionId: 'ad993ae4-c0b8-4ef8-8292-26321ed33eb7',
    userId: 'owner-1'
  })

  try {
    expect(
      await helmExecutions.cancel({
        executionId: 'ad993ae4-c0b8-4ef8-8292-26321ed33eb7',
        userId: 'other-user'
      })
    ).toBe(false)
    expect(execution.signal.aborted).toBe(false)

    const cancellation = helmExecutions.cancel({
      executionId: 'ad993ae4-c0b8-4ef8-8292-26321ed33eb7',
      userId: 'owner-1'
    })
    expect(execution.signal.aborted).toBe(true)
    expect(execution.signal.reason.code).toBe('HELM_CANCELLED')
    execution.release()
    expect(await cancellation).toBe(true)
  } finally {
    execution.release()
  }
})

test('Helm execution IDs cannot be reused while active', async ({ expect }) => {
  const first = helmExecutions.register({
    executionId: '1650a071-a3cd-4b9c-b5f9-35283c2dbb03',
    userId: 'owner-1'
  })

  try {
    let error
    try {
      helmExecutions.register({
        executionId: '1650a071-a3cd-4b9c-b5f9-35283c2dbb03',
        userId: 'owner-1'
      })
    } catch (caughtError) {
      error = caughtError
    }

    expect(error.code).toBe('HELM_EXECUTION_EXISTS')
  } finally {
    first.release()
  }
})

test('Helm execution stops when its requesting client disconnects', async ({
  sails,
  expect
}) => {
  const response = new EventEmitter()
  response.writableEnded = false
  const execution = sails.helpers.helm.beginExecution(
    'e1c2455b-bfe9-432a-adbb-93762b8a9b0a',
    { session: { userId: 'owner-1' } },
    response
  )

  try {
    response.emit('close')
    expect(execution.signal.aborted).toBe(true)
    expect(execution.signal.reason.code).toBe('HELM_CANCELLED')
  } finally {
    execution.release()
  }
})

test('Command cancellation only confirms a verified cancelled terminal result', async ({
  expect
}) => {
  for (const status of [
    'cancelled',
    'unconfirmed',
    'success',
    'error',
    'timeout'
  ]) {
    const id = `command-confirmation-${status}`
    const execution = helmExecutions.register({
      executionId: id,
      userId: 'owner-1',
      requiresConfirmedCancellation: true
    })
    const cancellation = helmExecutions.cancel({
      executionId: id,
      userId: 'owner-1'
    })
    expect(execution.signal.aborted).toBe(true)
    execution.release({ status, terminationConfirmed: true })
    execution.release({
      status: status === 'cancelled' ? 'unconfirmed' : 'cancelled'
    })
    expect(await cancellation).toBe(status === 'cancelled')
  }
})

test('Command cancellation waits for terminal evidence and rejects missing confirmation', async () => {
  const assert = require('node:assert/strict')
  for (const terminationConfirmed of [undefined, false]) {
    const id = `command-no-confirmation-${String(terminationConfirmed)}`
    const execution = helmExecutions.register({
      executionId: id,
      userId: 'owner-1',
      requiresConfirmedCancellation: true
    })
    let settled = false
    const pending = helmExecutions
      .cancel({ executionId: id, userId: 'owner-1' })
      .then((result) => {
        settled = true
        return result
      })
    await new Promise((resolve) => setImmediate(resolve))
    assert.equal(settled, false)
    assert.equal(execution.signal.aborted, true)
    execution.release({ status: 'cancelled', terminationConfirmed })
    assert.equal(await pending, false)
  }
})

test('Command admission notices a disconnect that happened before listener registration', async ({
  sails,
  expect
}) => {
  for (const kind of ['request-aborted', 'response-destroyed']) {
    const response = new EventEmitter()
    response.writableEnded = false
    response.destroyed = kind === 'response-destroyed'
    const execution = sails.helpers.helm.beginExecution.with({
      executionId: `command-early-${kind}`,
      req: {
        session: { userId: 'owner-1' },
        aborted: kind === 'request-aborted'
      },
      res: response,
      requiresConfirmedCancellation: true
    })
    try {
      expect(execution.signal.aborted).toBe(true)
      expect(execution.signal.reason.code).toBe('HELM_CANCELLED')
    } finally {
      execution.release({ status: 'cancelled', terminationConfirmed: true })
    }
    expect(response.listenerCount('close')).toBe(0)
  }
})
