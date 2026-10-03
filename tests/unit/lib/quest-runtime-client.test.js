const assert = require('node:assert/strict')
const vm = require('node:vm')
const path = require('node:path')
const { EventEmitter } = require('node:events')
const { PassThrough } = require('node:stream')
const { test } = require('sounding')
const {
  request,
  residentRequest
} = require('../../../api/lib/quest-runtime-client')

const DIRECTORY = '/tmp/slipway-quest-runtimes'
function identityFixture(change = () => {}) {
  const identities = [
    {
      version: 1,
      appId: '12',
      deploymentId: '34',
      runtimeId: 'runtime-fixture',
      pid: 123,
      startTicks: '789',
      socket: `${DIRECTORY}/12-34-123.sock`
    }
  ]
  const config = {
    identities,
    directoryMode: 0o700,
    directoryUid: 1000,
    fileMode: 0o600,
    fileUid: 1000,
    fileSize: 200,
    socketMode: 0o600,
    socketUid: 1000,
    procUid: 1000,
    startTicks: '789',
    environment: 'SLIPWAY_APP_ID=12\0SLIPWAY_DEPLOYMENT_ID=34\0',
    directoryType: true,
    fileType: true,
    socketType: true,
    response: { ok: true, data: { version: 1 } }
  }
  change(config)
  const connections = [],
    writes = []
  const fs = {
    lstatSync(filename) {
      if (filename === DIRECTORY)
        return {
          mode: config.directoryMode,
          uid: config.directoryUid,
          isDirectory: () => config.directoryType
        }
      if (filename.endsWith('.json'))
        return {
          mode: config.fileMode,
          uid: config.fileUid,
          size: config.fileSize,
          isFile: () => config.fileType
        }
      return {
        mode: config.socketMode,
        uid: config.socketUid,
        isSocket: () => config.socketType
      }
    },
    readdirSync() {
      return identities.map((identity) => `12-34-${identity.pid}.json`)
    },
    readFileSync(filename) {
      if (filename.endsWith('.json'))
        return JSON.stringify(
          identities.find((identity) =>
            filename.endsWith(`-${identity.pid}.json`)
          )
        )
      if (filename.endsWith('/stat'))
        return `123 (node (resident)) ${[
          ...Array(19).fill('0'),
          config.startTicks
        ].join(' ')}`
      if (filename.endsWith('/status'))
        return `Uid:\t${config.procUid}\t${config.procUid}\t${config.procUid}\t${config.procUid}\n`
      if (filename.endsWith('/environ')) return config.environment
      throw new Error(`Unexpected read: ${filename}`)
    }
  }
  const net = {
    createConnection(socketPath) {
      connections.push(socketPath)
      const socket = new EventEmitter()
      socket.setTimeout = () => socket
      socket.destroy = (error) => error && socket.emit('error', error)
      socket.write = (wire) => {
        writes.push(JSON.parse(wire))
        queueMicrotask(() => {
          socket.emit('data', Buffer.from(JSON.stringify(config.response)))
          socket.emit('end')
        })
      }
      queueMicrotask(() => socket.emit('connect'))
      return socket
    }
  }
  const sandbox = {
    Buffer,
    require(name) {
      if (name === 'node:fs') return fs
      if (name === 'node:path') return path
      if (name === 'node:net') return net
      throw new Error(`The resident transport must not load ${name}`)
    }
  }
  return {
    connections,
    writes,
    config,
    run: (message = {}) =>
      vm.runInNewContext(
        `(${residentRequest.toString()})(${JSON.stringify({
          appId: '12',
          deploymentId: '34',
          command: 'snapshot',
          ...message
        })})`,
        sandbox
      )
  }
}

function childFixture(reply = { ok: true, data: { accepted: true } }) {
  const calls = []
  let source = '',
    killed = 0
  const spawn = (...args) => {
    calls.push(args)
    const child = new EventEmitter()
    child.stdin = new PassThrough()
    child.stdout = new PassThrough()
    child.stderr = new PassThrough()
    child.kill = () => killed++
    child.stdin.on('data', (chunk) => {
      source += chunk.toString()
    })
    child.stdin.on('finish', () =>
      queueMicrotask(() => {
        if (reply instanceof Error) child.emit('error', reply)
        else if (typeof reply === 'function') reply(child)
        else {
          child.stdout.write(JSON.stringify(reply))
          child.emit('close', 0)
        }
      })
    )
    return child
  }
  return { calls, spawn, source: () => source, killed: () => killed }
}
const APP = {
  id: 12,
  currentDeployment: 34,
  containerName: 'synthetic-never-real'
}

test('Quest transport only executes node in the selected container and never starts Sails, shell, or npx', async () => {
  const child = childFixture()
  assert.deepEqual(
    await request(
      APP,
      'snapshot',
      {},
      { spawn: child.spawn, binary: 'synthetic-docker' }
    ),
    { accepted: true }
  )
  assert.equal(child.calls.length, 1)
  assert.deepEqual(child.calls[0].slice(0, 2), [
    'synthetic-docker',
    ['exec', '-i', 'synthetic-never-real', 'node']
  ])
  assert.deepEqual(child.calls[0][2].stdio, ['pipe', 'pipe', 'pipe'])
  assert.equal(child.calls[0][2].timeout, 7000)
  const fixture = identityFixture()
  const result = await fixture.run()
  assert.equal(result.ok, true)
  assert.deepEqual(fixture.connections, [`${DIRECTORY}/12-34-123.sock`])
  assert.equal(
    /\bnpx\b|\.lift\(|sails\.load|require\(['"]sails['"]\)/.test(
      child.source()
    ),
    false
  )
})

test('Quest resident discovery verifies PID start ticks, app/deployment environment, identity, ownership and private permissions', async () => {
  const invalid = [
    (c) => {
      c.directoryMode = 0o755
    },
    (c) => {
      c.directoryUid = 999
    },
    (c) => {
      c.directoryType = false
    },
    (c) => {
      c.fileMode = 0o644
    },
    (c) => {
      c.fileUid = 999
    },
    (c) => {
      c.fileType = false
    },
    (c) => {
      c.fileSize = 4097
    },
    (c) => {
      c.socketMode = 0o666
    },
    (c) => {
      c.socketUid = 999
    },
    (c) => {
      c.socketType = false
    },
    (c) => {
      c.startTicks = 'reused-pid'
    },
    (c) => {
      c.procUid = 999
    },
    (c) => {
      c.environment = 'SLIPWAY_APP_ID=13\0SLIPWAY_DEPLOYMENT_ID=34\0'
    },
    (c) => {
      c.environment = 'SLIPWAY_APP_ID=12\0SLIPWAY_DEPLOYMENT_ID=35\0'
    },
    (c) => {
      c.environment += 'SLIPWAY_HELM_EXECUTION_ID=temporary\0'
    },
    (c) => {
      c.identities[0].version = 2
    },
    (c) => {
      c.identities[0].appId = '13'
    },
    (c) => {
      c.identities[0].deploymentId = '35'
    },
    (c) => {
      c.identities[0].socket = '/tmp/arbitrary.sock'
    },
    (c) => {
      c.identities[0].pid = -1
    },
    (c) => {
      c.identities.push({
        ...c.identities[0],
        pid: 456,
        socket: `${DIRECTORY}/12-34-456.sock`
      })
    }
  ]
  for (const change of invalid) {
    const fixture = identityFixture(change)
    await assert.rejects(async () => fixture.run())
    assert.equal(fixture.connections.length, 0)
  }
  const fixture = identityFixture()
  await assert.rejects(async () => fixture.run({ runtimeId: 'old-runtime' }))
  assert.equal(fixture.connections.length, 0)
})

test('Quest target and request byte limits reject before creating a transport process', async () => {
  const child = childFixture()
  for (const app of [
    { ...APP, containerName: null },
    { ...APP, currentDeployment: null }
  ])
    await assert.rejects(request(app, 'invoke', {}, { spawn: child.spawn }))
  await assert.rejects(
    request(
      APP,
      'invoke',
      { jobInputs: { payload: 'x'.repeat(32 * 1024) } },
      { spawn: child.spawn }
    )
  )
  assert.equal(child.calls.length, 0)
})

test('Quest transport bounds output and diagnostics and reports unconfirmed failures without fallback execution', async () => {
  const excessive = childFixture((child) => {
    child.stdout.write('x'.repeat(512 * 1024 + 1))
    child.emit('close', 0)
  })
  await assert.rejects(
    request(APP, 'snapshot', {}, { spawn: excessive.spawn }),
    /512 KiB/
  )
  assert.equal(excessive.killed(), 1)
  assert.equal(excessive.calls.length, 1)
  for (const reply of [
    new Error('unavailable'),
    (child) => {
      child.stdout.write('invalid JSON')
      child.emit('close', 0)
    },
    (child) => {
      child.stderr.write('x'.repeat(10000))
      child.emit('close', 1)
    }
  ]) {
    const child = childFixture(reply)
    await assert.rejects(
      request(APP, 'invoke', {}, { spawn: child.spawn }),
      (error) => {
        assert.ok(error.message.length <= 2048)
        return true
      }
    )
    assert.equal(child.calls.length, 1)
  }
  const rejected = childFixture({
    ok: false,
    error: { code: 'QUEST_TARGET_CHANGED', message: 'stale target' }
  })
  await assert.rejects(request(APP, 'invoke', {}, { spawn: rejected.spawn }), {
    code: 'QUEST_TARGET_CHANGED'
  })
})

test('Quest stream viewer closure only clears polling and never invokes run cancellation', async () => {
  const workspace = require('../../../api/lib/quest-workspace')
  const runtime = require('../../../api/lib/quest-runtime-client')
  const action = require('../../../api/controllers/api/v1/quest/stream-jobs')
  const original = {
    resolveContext: workspace.resolveContext,
    snapshot: workspace.snapshot,
    request: runtime.request
  }
  let close,
    finish,
    requests = 0,
    sent = 0
  const stream = {
    closed: false,
    send: () => sent++,
    onClose: (callback) => {
      close = callback
    },
    wait: () =>
      new Promise((resolve) => {
        finish = resolve
      })
  }
  workspace.resolveContext = async () => ({})
  workspace.snapshot = async () => ({
    mode: 'resident',
    runs: [{ runId: 'still-running' }]
  })
  runtime.request = async () => {
    requests++
    throw new Error('Viewer must not control a process')
  }
  try {
    const pending = action.fn.call(
      { req: {}, res: { sse: () => stream } },
      { projectSlug: 'synthetic' }
    )
    await new Promise((resolve) => setImmediate(resolve))
    assert.equal(sent, 1)
    assert.equal(typeof close, 'function')
    stream.closed = true
    close()
    finish()
    await pending
    assert.equal(requests, 0)
  } finally {
    close?.()
    Object.assign(workspace, {
      resolveContext: original.resolveContext,
      snapshot: original.snapshot
    })
    runtime.request = original.request
  }
})
