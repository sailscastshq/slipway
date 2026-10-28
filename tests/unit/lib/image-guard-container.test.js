const { test } = require('node:test')
const assert = require('node:assert/strict')
const { randomUUID } = require('node:crypto')
const vm = require('node:vm')
const { create } = require('../../../api/lib/image-guard-container')._private

function fixture() {
  const id = 'a'.repeat(64)
  const oldId = 'b'.repeat(64)
  const daemonId = 'c'.repeat(64)
  const startedAt = '2026-10-28T09:00:00.000000000Z'
  const identity = {
    bootId: randomUUID(),
    namespace: 'pid:[101]',
    startTicks: '100'
  }
  const current = { ...identity, container: { id, daemonId, startedAt } }
  const owner = {
    ...identity,
    namespace: 'pid:[99]',
    container: { id: oldId, daemonId, startedAt }
  }
  const record = {
    version: 3,
    pid: 19,
    mode: 'use',
    token: randomUUID(),
    startedAt: Date.now(),
    owner
  }
  const receipt = (value) => ({
    id: value,
    startedAt,
    running: true,
    restarting: false,
    paused: false,
    pid: 123,
    status: 'running',
    pidMode: ''
  })
  const state = {
    old: receipt(oldId),
    self: receipt(id),
    daemonId,
    missing: false,
    ticks: '100',
    denied: false,
    calls: [],
    hostname: id.slice(0, 12),
    namespace: owner.namespace
  }
  const api = create({
    read: async () => state.hostname,
    run: async (binary, args, options) => {
      state.calls.push(args)
      assert.ok(['inspect', 'info', 'exec'].includes(args[0]))
      assert.equal(options.timeout, 2000)
      assert.ok(options.maxBuffer <= 16384)
      if (state.denied)
        throw Object.assign(new Error('daemon unavailable'), {
          code: 1,
          stderr: 'permission denied'
        })
      if (args[0] === 'info') return { stdout: state.daemonId }
      if (args[0] === 'inspect') {
        if (args.at(-1) === id || args.at(-1) === state.hostname)
          return { stdout: JSON.stringify(state.self) }
        if (state.missing)
          throw Object.assign(new Error('not found'), {
            code: 1,
            stderr: `Error response from daemon: No such container: ${oldId}`
          })
        return { stdout: JSON.stringify(state.old) }
      }
      const processOwner = args[1] === id ? identity : owner
      let stdout
      // Execute the real generated probe, including its /proc stat parser.
      vm.runInNewContext(args[4], {
        require: () => ({
          readlinkSync: () =>
            args[1] === id ? processOwner.namespace : state.namespace,
          readFileSync: (file) => {
            if (file.endsWith('boot_id')) return processOwner.bootId
            if (state.ticks === null)
              throw Object.assign(new Error(), { code: 'ENOENT' })
            return `19 (node worker) ${Array.from({ length: 20 }, (_, index) =>
              index === 19 ? state.ticks : '0'
            ).join(' ')}`
          }
        }),
        console: {
          log: (value) => {
            stdout = value
          }
        }
      })
      return { stdout }
    }
  })
  return { api, state, current, record, identity }
}

test('container identity requires immutable ID, local kernel namespace and exact process incarnation', async () => {
  const { api, state, current, identity } = fixture()
  assert.deepEqual(await api.identify(identity, 19), current.container)
  state.ticks = '101'
  assert.equal(await api.identify(identity, 19), null)
  state.hostname = 'unverified-hostname'
  assert.equal(await api.identify(identity, 19), null)
})

test('same container incarnation distinguishes live, exited and reused PIDs across namespaces', async () => {
  const { api, state, current, record } = fixture()
  assert.equal(await api.state(record, current), 'live')
  state.ticks = '101'
  assert.equal(await api.state(record, current), 'dead')
  state.ticks = null
  assert.equal(await api.state(record, current), 'dead')
})

test('stopped, removed and restarted immutable containers prove only their original owner stopped', async () => {
  const { api, state, current, record } = fixture()
  state.old.running = false
  state.old.status = 'exited'
  state.old.pid = 0
  assert.equal(await api.state(record, current), 'dead')
  state.missing = true
  assert.equal(await api.state(record, current), 'dead')
  state.missing = false
  state.old.running = true
  state.old.status = 'running'
  state.old.pid = 999
  state.old.startedAt = '2026-10-28T10:00:00Z'
  assert.equal(await api.state(record, current), 'dead')
  assert.equal(
    state.calls.some((args) => /prune|rm|run|stop|kill/.test(args[0])),
    false
  )
})

test('daemon mismatch, inspection errors, paused/restarting owners and shared PID modes stay unknown', async () => {
  for (const change of [
    ({ state }) => {
      state.denied = true
    },
    ({ state }) => {
      state.daemonId = 'd'.repeat(64)
    },
    ({ state }) => {
      state.old.id = 'd'.repeat(64)
    },
    ({ state }) => {
      state.old.pidMode = 'host'
    },
    ({ state }) => {
      state.old.paused = true
    },
    ({ state }) => {
      state.old.restarting = true
    },
    ({ state }) => {
      state.namespace = 'pid:[1234]'
    },
    ({ record }) => {
      record.owner.container.id = 'mutable-name'
    },
    ({ current }) => {
      delete current.container
    }
  ]) {
    const value = fixture()
    change(value)
    assert.equal(await value.api.state(value.record, value.current), 'unknown')
  }
})

test('namespace mismatches and a changing container receipt cannot authorize recovery', async () => {
  const value = fixture()
  // Change the immutable receipt between inspections to simulate restart.
  let calls = 0
  const descriptor = { ...value.state.old }
  Object.defineProperty(value.state, 'old', {
    get() {
      return { ...descriptor, pid: ++calls === 1 ? 123 : 456 }
    }
  })
  assert.equal(await value.api.state(value.record, value.current), 'unknown')
})

test('daemon changing during a missing-container proof preserves the guard', async () => {
  const value = fixture()
  value.state.missing = true
  let calls = 0
  Object.defineProperty(value.state, 'daemonId', {
    get() {
      return ++calls === 1 ? value.current.container.daemonId : 'd'.repeat(64)
    }
  })
  assert.equal(await value.api.state(value.record, value.current), 'unknown')
})
