const { Readable, Writable } = require('node:stream')

const { test } = require('sounding')

test('process output streams with backpressure instead of being held in memory', async ({
  sails,
  expect
}) => {
  const outputBytes = 4 * 1024 * 1024
  let writtenBytes = 0
  const output = new Writable({
    highWaterMark: 1024,
    write(chunk, encoding, callback) {
      writtenBytes += chunk.length
      setImmediate(callback)
    }
  })

  const result = await sails.helpers.streams.runProcess.with({
    command: process.execPath,
    args: [
      '-e',
      `const chunk = Buffer.alloc(65536); let left = ${outputBytes}; function write() { while (left > 0) { const next = chunk.subarray(0, Math.min(left, chunk.length)); left -= next.length; if (!process.stdout.write(next)) return process.stdout.once('drain', write) } } write()`
    ],
    output,
    timeoutMs: 5000,
    maxOutputBytes: outputBytes,
    maxStderrBytes: 1024
  })

  expect(writtenBytes).toBe(outputBytes)
  expect(result.outputBytes).toBe(outputBytes)
  expect(result.stdout).toBe('')
})

test('an AbortSignal cancels a running process', async ({ sails, expect }) => {
  const controller = new AbortController()
  const operation = sails.helpers.streams.runProcess.with({
    command: process.execPath,
    args: ['-e', 'setInterval(() => {}, 1000)'],
    timeoutMs: 5000,
    maxOutputBytes: 1024,
    maxStderrBytes: 1024,
    signal: controller.signal,
    killGraceMs: 50
  })

  setTimeout(() => controller.abort(), 20)
  const error = await captureError(operation)

  expect(error.code).toBe('PROCESS_ABORTED')
})

test('a disk-full output error stops the producing process', async ({
  sails,
  expect
}) => {
  let writes = 0
  const output = new Writable({
    write(chunk, encoding, callback) {
      writes += 1
      const error = new Error('No space left on device')
      error.code = 'ENOSPC'
      callback(error)
    }
  })

  const error = await captureError(
    sails.helpers.streams.runProcess.with({
      command: process.execPath,
      args: [
        '-e',
        'setInterval(() => process.stdout.write(Buffer.alloc(65536)), 1)'
      ],
      output,
      timeoutMs: 5000,
      maxOutputBytes: 8 * 1024 * 1024,
      maxStderrBytes: 1024,
      killGraceMs: 50
    })
  )

  expect(writes).toBe(1)
  expect(error.code).toBe('ENOSPC')
})

test('process stderr is truncated at its configured memory limit', async ({
  sails,
  expect
}) => {
  const error = await captureError(
    sails.helpers.streams.runProcess.with({
      command: process.execPath,
      args: ['-e', "process.stderr.write('x'.repeat(16384)); process.exit(7)"],
      timeoutMs: 5000,
      maxOutputBytes: 1024,
      maxStderrBytes: 512
    })
  )

  expect(error.code).toBe('PROCESS_FAILED')
  expect(Buffer.byteLength(error.stderr)).toBe(512)
  expect(error.stderrTruncated).toBe(true)
})

test('a failed process reports stderr instead of a streaming EPIPE', async ({
  sails,
  expect
}) => {
  const input = Readable.from(
    (async function* () {
      for (let index = 0; index < 256; index += 1) {
        yield Buffer.alloc(64 * 1024)
      }
    })()
  )

  const error = await captureError(
    sails.helpers.streams.runProcess.with({
      command: process.execPath,
      args: [
        '-e',
        "process.stderr.write('invalid database dump'); process.exit(6)"
      ],
      input,
      timeoutMs: 5000,
      maxInputBytes: 32 * 1024 * 1024,
      maxOutputBytes: 1024,
      maxStderrBytes: 1024
    })
  )

  expect(error.code).toBe('PROCESS_FAILED')
  expect(error.stderr).toContain('invalid database dump')
})

test('an aborted stream copy tears down both ends', async ({
  sails,
  expect
}) => {
  const controller = new AbortController()
  const input = new Readable({
    read() {
      setTimeout(() => this.push(Buffer.alloc(1024)), 5)
    }
  })
  const output = new Writable({
    write(chunk, encoding, callback) {
      setTimeout(callback, 5)
    }
  })

  const operation = sails.helpers.streams.copy.with({
    input,
    output,
    maxBytes: 1024 * 1024,
    signal: controller.signal
  })
  setTimeout(() => controller.abort(), 20)

  const error = await captureError(operation)
  expect(error.code).toBe('ABORT_ERR')
  expect(input.destroyed).toBe(true)
  expect(output.destroyed).toBe(true)
})

test('a stream copy has an explicit transfer deadline', async ({
  sails,
  expect
}) => {
  const input = new Readable({
    read() {}
  })
  const output = new Writable({
    write(chunk, encoding, callback) {
      callback()
    }
  })

  const error = await captureError(
    sails.helpers.streams.copy.with({
      input,
      output,
      maxBytes: 1024,
      label: 'Test transfer',
      timeoutMs: 20
    })
  )

  expect(error.code).toBe('STREAM_TIMEOUT')
  expect(input.destroyed).toBe(true)
  expect(output.destroyed).toBe(true)
})

async function captureError(promise) {
  try {
    await promise
  } catch (error) {
    return error
  }

  throw new Error('Expected operation to fail.')
}
