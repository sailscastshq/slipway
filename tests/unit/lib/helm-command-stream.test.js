const { test } = require('sounding')
const assert = require('node:assert/strict')

const EXECUTION_ID = '5e93e507-9b45-4b12-b958-05699ab28018'
const ACCEPTED = { type: 'accepted', executionId: EXECUTION_ID }
const RESULT = {
  success: false,
  status: 'error',
  exitCode: 7,
  signal: null,
  durationMs: 42,
  terminationConfirmed: true,
  terminationScope: 'foreground-process-group',
  outputBytes: 6,
  truncated: false
}
const terminal = (result = RESULT) => ({
  type: 'result',
  executionId: EXECUTION_ID,
  result
})
const encode = (events) => Buffer.from(events.map(JSON.stringify).join('\n'))

function responseFor(chunks, { readError, cancelError } = {}) {
  const state = { cancelled: 0, released: 0 }
  let index = 0
  const body = new ReadableStream({
    pull(controller) {
      if (index < chunks.length) controller.enqueue(chunks[index++])
      else if (readError) controller.error(readError)
      else controller.close()
    }
  })
  const response = new Response(body)
  const getReader = body.getReader.bind(body)
  body.getReader = () => {
    const reader = getReader()
    return {
      read: () => reader.read(),
      async cancel() {
        state.cancelled++
        if (cancelError) throw cancelError
        return reader.cancel()
      },
      releaseLock() {
        state.released++
        reader.releaseLock()
      }
    }
  }
  return { state, response }
}

async function reader() {
  return (await import('../../../assets/js/lib/helmCommandStream.mjs'))
    .readHelmCommandStream
}

test('Helm command stream decodes split NDJSON and UTF-8 without altering native status', async () => {
  const read = await reader()
  const output = { type: 'stdout', text: 'café 🚀\n' }
  const stderr = { type: 'stderr', text: 'diagnostic\n' }
  const wire = encode([
    ACCEPTED,
    { type: 'started' },
    output,
    stderr,
    terminal()
  ])
  // Every possible byte boundary includes boundaries inside multibyte UTF-8.
  for (let boundary = 1; boundary < wire.length; boundary++) {
    const { response, state } = responseFor([
      wire.subarray(0, boundary),
      wire.subarray(boundary)
    ])
    const events = []
    assert.deepEqual(
      await read(response, {
        executionId: EXECUTION_ID,
        onEvent: (event) => events.push(event)
      }),
      RESULT
    )
    assert.deepEqual(events, [ACCEPTED, { type: 'started' }, output, stderr])
    assert.deepEqual(state, { cancelled: 0, released: 1 })
  }
})

test('Helm command stdout and stderr are delivered before terminal completion', async () => {
  const read = await reader()
  let finish
  const events = []
  const stream = new ReadableStream({
    start(controller) {
      controller.enqueue(
        Buffer.concat([
          encode([
            ACCEPTED,
            { type: 'started' },
            { type: 'stdout', text: 'first\n' },
            { type: 'stderr', text: 'second\n' }
          ]),
          Buffer.from('\n')
        ])
      )
      finish = () => {
        controller.enqueue(encode([terminal()]))
        controller.close()
      }
    }
  })
  let completed = false
  const pending = read(
    { ok: true, body: stream },
    { executionId: EXECUTION_ID, onEvent: (event) => events.push(event) }
  ).then((result) => {
    completed = true
    return result
  })
  await new Promise((resolve) => setImmediate(resolve))
  assert.equal(completed, false)
  assert.deepEqual(
    events.map((event) => event.type),
    ['accepted', 'started', 'stdout', 'stderr']
  )
  finish()
  assert.deepEqual(await pending, RESULT)
})

test('Helm command transport preserves every supported terminal status', async () => {
  const read = await reader()
  for (const status of [
    'success',
    'error',
    'cancelled',
    'timeout',
    'unconfirmed'
  ]) {
    const result = {
      ...RESULT,
      status,
      success: status === 'success',
      exitCode: status === 'success' ? 0 : null,
      signal: status === 'success' ? null : 'SIGTERM',
      terminationConfirmed: status !== 'unconfirmed',
      truncated: true
    }
    const { response } = responseFor([encode([ACCEPTED, terminal(result)])])
    assert.deepEqual(
      await read(response, { executionId: EXECUTION_ID, onEvent() {} }),
      result
    )
  }
})

test('Helm command rejects missing, malformed, mismatched, and out-of-order terminal evidence', async () => {
  const read = await reader()
  const invalidStreams = [
    '',
    encode([ACCEPTED]),
    encode([{ type: 'started' }, ACCEPTED, terminal()]),
    encode([{ ...ACCEPTED, executionId: 'another-execution' }, terminal()]),
    encode([ACCEPTED, ACCEPTED, terminal()]),
    encode([ACCEPTED, { type: 'stdout', text: 12 }, terminal()]),
    encode([ACCEPTED, { type: 'unknown' }, terminal()]),
    encode([ACCEPTED, { ...terminal(), executionId: 'another-execution' }]),
    encode([ACCEPTED, terminal({ status: 'stopped' })]),
    encode([ACCEPTED, terminal(), { type: 'stdout', text: 'too late' }]),
    encode([ACCEPTED, terminal(), terminal()]),
    Buffer.from(`${JSON.stringify(ACCEPTED)}\nnot json\n`)
  ]
  for (const wire of invalidStreams) {
    const { response, state } = responseFor([Buffer.from(wire)])
    await assert.rejects(
      read(response, { executionId: EXECUTION_ID, onEvent() {} })
    )
    assert.deepEqual(state, { cancelled: 1, released: 1 })
  }
})

test('Helm command stream enforces a byte budget and releases failed transports', async () => {
  const read = await reader()
  const wire = encode([ACCEPTED, terminal()])
  const bounded = responseFor([wire])
  await assert.rejects(
    read(bounded.response, {
      executionId: EXECUTION_ID,
      onEvent() {},
      maxBytes: wire.length - 1
    }),
    /transport limit/
  )
  assert.deepEqual(bounded.state, { cancelled: 1, released: 1 })
  const broken = responseFor([encode([ACCEPTED])], {
    readError: new Error('lost transport'),
    cancelError: new Error('already disconnected')
  })
  await assert.rejects(
    read(broken.response, { executionId: EXECUTION_ID, onEvent() {} }),
    /lost transport/
  )
  assert.deepEqual(broken.state, { cancelled: 1, released: 1 })
})

test('Helm command HTTP refusal remains a request failure, not an executed command result', async () => {
  const read = await reader()
  for (const [body, expectedMessage, expectedCode] of [
    [
      JSON.stringify({
        message: 'Arm this exact command',
        code: 'HELM_WRITES_NOT_ARMED'
      }),
      'Arm this exact command',
      'HELM_WRITES_NOT_ARMED'
    ],
    [
      '<html>Gateway unavailable</html>',
      'HTTP 409',
      'HELM_COMMAND_REQUEST_FAILED'
    ]
  ]) {
    await assert.rejects(
      read(new Response(body, { status: 409 }), {
        executionId: EXECUTION_ID,
        onEvent() {}
      }),
      (error) =>
        error.requestFailed === true &&
        error.code === expectedCode &&
        error.message.includes(expectedMessage)
    )
  }
  await assert.rejects(
    read({ ok: true, body: null }, { executionId: EXECUTION_ID, onEvent() {} }),
    /unavailable/
  )
})

test('Helm command decoder rejects contradictory native exit or cancellation evidence', async () => {
  const read = await reader()
  for (const result of [
    { ...RESULT, exitCode: '7' },
    { ...RESULT, exitCode: -1 },
    { ...RESULT, success: true },
    { ...RESULT, status: 'success', success: true, exitCode: 7 },
    { ...RESULT, status: 'success', success: true, exitCode: null },
    { ...RESULT, terminationConfirmed: false },
    { ...RESULT, terminationConfirmed: undefined },
    { ...RESULT, status: 'cancelled', terminationConfirmed: false }
  ]) {
    const { response, state } = responseFor([
      encode([ACCEPTED, terminal(result)])
    ])
    await assert.rejects(
      read(response, { executionId: EXECUTION_ID, onEvent() {} }),
      /contradictory exit evidence/
    )
    assert.deepEqual(state, { cancelled: 1, released: 1 })
  }
})

test('Helm command refusal bodies are bounded and release their reader', async () => {
  const read = await reader()
  let cancelled = false
  const body = new ReadableStream({
    pull(controller) {
      controller.enqueue(Buffer.alloc(5000, 'x'))
    },
    cancel() {
      cancelled = true
    }
  })
  await assert.rejects(
    read(new Response(body, { status: 503 }), {
      executionId: EXECUTION_ID,
      onEvent() {}
    }),
    (error) =>
      error.requestFailed === true &&
      error.code === 'HELM_COMMAND_REQUEST_FAILED'
  )
  assert.equal(cancelled, true)
  assert.equal(body.locked, false)
})

test('Helm command parser handles tiny transport chunks and preserves output as inert text', async () => {
  const read = await reader()
  const text =
    '\u001b[31m<img src=x onerror="throw new Error(\'never evaluate\')">\u001b[0m\n'
  const output = { type: 'stdout', text }
  const wire = encode([ACCEPTED, { type: 'started' }, output, terminal()])
  const events = []
  const { response } = responseFor(
    Array.from(wire, (byte) => Uint8Array.of(byte))
  )
  assert.deepEqual(
    await read(response, {
      executionId: EXECUTION_ID,
      onEvent: (event) => events.push(event)
    }),
    RESULT
  )
  assert.deepEqual(events[2], output)
})
