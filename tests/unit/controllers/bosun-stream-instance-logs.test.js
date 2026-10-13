const { EventEmitter } = require('node:events')
const { PassThrough } = require('node:stream')
const childProcess = require('node:child_process')
const { test } = require('sounding')

test('Bosun delivers stderr logs without waiting for stdout', async ({
  sails,
  expect
}) => {
  const docker = new EventEmitter()
  docker.stdout = new PassThrough()
  docker.stderr = new PassThrough()
  docker.kill = () => {}

  const originalSpawn = childProcess.spawn
  const controllerPath = require.resolve(
    '../../../api/controllers/api/v1/bosun/stream-instance-logs'
  )
  childProcess.spawn = () => docker
  delete require.cache[controllerPath]

  const sent = []
  const cleanup = []
  let finish
  const stream = {
    send(message) {
      sent.push(message)
    },
    close() {
      for (const callback of cleanup) callback()
      finish()
    },
    onClose(callback) {
      cleanup.push(callback)
    },
    wait() {
      return new Promise((resolve) => {
        finish = resolve
      })
    }
  }

  try {
    const controller = require(controllerPath)
    const result = controller.fn.call(
      {
        req: {},
        res: { sse: () => stream }
      },
      { tail: 200 }
    )

    docker.stderr.write('2026-08-12T12:00:00Z info: server ready\n')
    await new Promise((resolve) => setImmediate(resolve))

    expect(
      sent.some(
        (message) => message.log === '2026-08-12T12:00:00Z info: server ready'
      )
    ).toBe(true)

    docker.emit('close', 0, null)
    await result
  } finally {
    childProcess.spawn = originalSpawn
    delete require.cache[controllerPath]
    sails.config.docker ||= {}
  }
})

test('Bosun historical and live log framing preserves registered identity and masks secrets through SSE', async () => {
  const assert = require('node:assert/strict')
  const { hook } = require('../../support/public-log-identifiers-fixture')()
  const docker = new EventEmitter()
  docker.stdout = new PassThrough()
  docker.stderr = new PassThrough()
  docker.kill = () => {}
  const originalSpawn = childProcess.spawn
  const controllerPath = require.resolve(
    '../../../api/controllers/api/v1/bosun/stream-instance-logs'
  )
  childProcess.spawn = () => docker
  delete require.cache[controllerPath]
  const sent = [],
    cleanup = []
  let finish
  const stream = {
    send(value) {
      sent.push(value)
    },
    close() {
      cleanup.forEach((callback) => callback())
      finish()
    },
    onClose(callback) {
      cleanup.push(callback)
    },
    wait() {
      return new Promise((resolve) => {
        finish = resolve
      })
    }
  }
  const res = { statusCode: 200, sse: () => stream, set() {} }
  hook.routes.before['/*'](
    { options: { action: 'api/v1/bosun/stream-instance-logs' } },
    res,
    () => {}
  )
  try {
    const pending = require(controllerPath).fn.call(
      { req: {}, res },
      { tail: 200 }
    )
    const historical = hook.text(
      'Running container: slipway-acaciaco-production-acaciaco-example-123'
    )
    const live = hook.text(
      'Source publicownerhq/acaciaco.example unknown-private-canary-768 confirmed-secret-canary-768'
    )
    docker.stdout.write(historical.slice(0, 25))
    docker.stdout.write(historical.slice(25) + '\n')
    docker.stderr.write(live.slice(0, 15))
    docker.stderr.write(live.slice(15) + '\n')
    docker.emit('close', 0, null)
    await pending
    assert.deepEqual(
      sent.filter((value) => value.log).map((value) => value.log),
      [
        'Running container: slipway-acaciaco-production-acaciaco-example-123',
        'Source publicownerhq/acaciaco.example [REDACTED] [REDACTED]'
      ]
    )
  } finally {
    childProcess.spawn = originalSpawn
    delete require.cache[controllerPath]
  }
})
