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
