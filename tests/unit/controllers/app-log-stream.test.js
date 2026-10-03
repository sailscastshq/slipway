const { test } = require('sounding')
const assert = require('node:assert/strict')
const childProcess = require('node:child_process')
const { EventEmitter } = require('node:events')
const { PassThrough } = require('node:stream')
test('app log streams enforce team and app scope, bound tails, and terminate snapshots', async ({
  sails
}) => {
  const originals = [
    User.forRequest,
    Project.findOne,
    Environment.findOne,
    App.findOne,
    childProcess.spawn
  ]
  const modulePath = require.resolve(
    '../../../api/controllers/api/v1/app/stream-container-logs'
  )
  const selections = []
  let projectAvailable = true
  User.forRequest = async () => ({ team: { id: 7 } })
  Project.findOne = async (criteria) => {
    assert.deepEqual(criteria, { slug: 'harbor', team: 7 })
    return projectAvailable ? { id: 3 } : null
  }
  Environment.findOne = async (criteria) => {
    assert.deepEqual(criteria, { slug: 'staging', project: 3 })
    return { id: 4 }
  }
  App.findOne = async (criteria) => {
    selections.push(criteria)
    return criteria.slug === 'missing'
      ? null
      : { containerName: criteria.slug || 'default' }
  }
  const calls = []
  const docker = new EventEmitter()
  docker.stdout = new PassThrough()
  docker.stderr = new PassThrough()
  let killed = 0
  docker.kill = () => killed++
  childProcess.spawn = (binary, args) => {
    calls.push(args)
    return docker
  }
  delete require.cache[modulePath]
  try {
    const controller = require(modulePath)
    const input = {
      projectSlug: 'harbor',
      environmentSlug: 'staging',
      appSlug: 'worker',
      tail: 2,
      follow: false
    }
    const messages = []
    const closeHandlers = []
    let complete
    const stream = {
      send: (data) => messages.push(data),
      onClose: (fn) => closeHandlers.push(fn),
      close: () => {
        closeHandlers.forEach((fn) => fn())
        complete()
      },
      wait: () =>
        new Promise((resolve) => {
          complete = resolve
        })
    }
    const context = { req: {}, res: { sse: () => stream } }
    const pending = controller.fn.call(context, input)
    await new Promise((resolve) => setImmediate(resolve))
    assert.deepEqual(selections, [{ environment: 4, slug: 'worker' }])
    assert.deepEqual(calls[0], [
      'logs',
      '--tail',
      '2',
      '--timestamps',
      'worker'
    ])
    docker.stdout.write('first\n')
    docker.stderr.write('last')
    docker.emit('close', 0)
    await pending
    assert.deepEqual(messages, [
      { connected: true, container: 'worker' },
      { log: 'first' },
      { log: 'last' },
      { closed: true }
    ])
    assert.equal(killed, 1)
    await assert.rejects(
      controller.fn.call(context, { ...input, tail: -1 }),
      (e) => Boolean(e.badRequest)
    )
    await assert.rejects(
      controller.fn.call(context, { ...input, appSlug: 'missing' }),
      (e) => e === 'notFound'
    )
    projectAvailable = false
    await assert.rejects(
      controller.fn.call(context, input),
      (e) => e === 'notFound'
    )
    assert.equal(calls.length, 1)
  } finally {
    ;[
      User.forRequest,
      Project.findOne,
      Environment.findOne,
      App.findOne,
      childProcess.spawn
    ] = originals
    delete require.cache[modulePath]
  }
})
