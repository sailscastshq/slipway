const { test } = require('node:test')
const assert = require('node:assert/strict')
const owners = require('../../../api/lib/service-provisioning-owner')
const { create } =
  require('../../../api/lib/service-provisioning-docker')._private
const stat = (ticks) =>
  `19 (node worker) ${Array.from({ length: 20 }, (_, i) =>
    i === 19 ? ticks : '0'
  ).join(' ')}`
const self = { boot: 'boot', namespace: 'pid:[1]' }
const old = {
  instance: 'previous',
  pid: 19,
  boot: 'boot',
  namespace: 'pid:[1]',
  ticks: '100'
}

test('live, reused PID, dead and uninspectable provisioners are distinguished without age expiry', async () => {
  assert.equal(
    await owners.dead(old, self, { readProcess: async () => stat('100') }),
    false
  )
  assert.equal(
    await owners.dead(old, self, { readProcess: async () => stat('200') }),
    true
  )
  assert.equal(
    await owners.dead(old, self, {
      readProcess: async () => {
        throw Object.assign(new Error(), { code: 'ENOENT' })
      }
    }),
    true
  )
  assert.equal(
    await owners.dead(old, self, {
      readProcess: async () => {
        throw Object.assign(new Error(), { code: 'EACCES' })
      }
    }),
    false
  )
  assert.equal(await owners.dead(old, { ...self, namespace: 'pid:[2]' }), false)
})
test('cross-namespace recovery requires a proved-ended Docker runtime generation', async () => {
  const previous = {
    ...old,
    container: { id: 'verified-container', startedAt: 'before' }
  }
  const current = { namespace: 'different', container: { id: 'current' } }
  assert.equal(
    await owners.dead(previous, current, {
      inspectContainer: async () => ({ running: true, startedAt: 'before' })
    }),
    false
  )
  assert.equal(
    await owners.dead(previous, current, {
      inspectContainer: async () => ({ running: true, startedAt: 'after' })
    }),
    true
  )
  assert.equal(
    await owners.dead(previous, current, {
      inspectContainer: async () => null
    }),
    true
  )
  await assert.rejects(
    owners.dead(previous, current, {
      inspectContainer: async () => {
        throw new Error('inspection failed')
      }
    })
  )
})
test('legacy recovery uses verified runtime generation, not a long elapsed wait', () => {
  const service = { createdAt: 1000 }
  assert.equal(owners.legacyInterrupted(service, { startedAt: 999999 }), false)
  assert.equal(
    owners.legacyInterrupted(service, {
      legacySafe: false,
      container: { running: true, startedAt: new Date(2000).toISOString() }
    }),
    false
  )
  assert.equal(
    owners.legacyInterrupted(service, {
      legacySafe: true,
      container: { running: true, startedAt: new Date(2000).toISOString() }
    }),
    true
  )
  assert.equal(
    owners.legacyInterrupted(service, {
      legacySafe: true,
      container: { running: true, startedAt: new Date(500).toISOString() }
    }),
    false
  )
})
function fixture({ container = null, volume = null } = {}) {
  const service = {
    id: 19,
    type: 'postgresql',
    password: 'fixture-secret',
    username: 'fixture',
    database: 'db',
    containerName: 'fixture-db',
    imageReference: 'postgres@sha256:fixed',
    imageMetadata: { volumeName: 'fixture-volume' }
  }
  const calls = []
  const runtime = create(async (args) => {
    calls.push(args)
    return args[0] === 'inspect'
      ? container && JSON.stringify([container])
      : args[0] === 'volume'
      ? volume && JSON.stringify([volume])
      : 'started'
  })
  return { runtime, service, calls }
}
const existing = () => ({
  Id: 'existing-container',
  Config: {
    Image: 'postgres@sha256:fixed',
    Env: [
      'POSTGRES_USER=fixture',
      'POSTGRES_PASSWORD=fixture-secret',
      'POSTGRES_DB=db',
      'PGDATA=/var/lib/postgresql/data'
    ]
  },
  Mounts: [
    {
      Type: 'volume',
      Name: 'fixture-volume',
      Destination: '/var/lib/postgresql'
    }
  ],
  NetworkSettings: { Networks: { slipway: {} } },
  State: { Running: true, Status: 'running' }
})
test('a matching running container is adopted without restarting or creating anything', async () => {
  const { runtime, service, calls } = fixture({
    container: existing(),
    volume: {}
  })
  assert.equal(
    (await runtime.reconcile(service)).containerId,
    'existing-container'
  )
  assert.deepEqual(
    calls.map((x) => x[0]),
    ['inspect', 'volume']
  )
})
test('a matching stopped container is started with its original volume', async () => {
  const c = existing()
  c.State = { Running: false, Status: 'exited' }
  const { runtime, service, calls } = fixture({ container: c, volume: {} })
  await runtime.reconcile(service)
  assert.deepEqual(calls.at(-1), ['start', 'fixture-db'])
})
test('mismatched artifacts and unproven existing volumes fail closed without leaking credentials', async () => {
  const c = existing()
  c.Config.Env[1] = 'POSTGRES_PASSWORD=different-secret'
  const { runtime, service, calls } = fixture({ container: c, volume: {} })
  await assert.rejects(
    runtime.reconcile(service),
    (e) => !e.message.includes('secret')
  )
  assert.equal(calls.length, 2)
  const other = fixture({ volume: {} })
  other.service.imageReference = null
  await assert.rejects(other.runtime.reconcile(other.service), /provenance/)
})
test('missing container and volume can continue original provisioning; verified existing volume is retained', async () => {
  const f = fixture()
  assert.equal(await f.runtime.reconcile(f.service), null)
  const retained = fixture({ volume: {} })
  assert.equal(await retained.runtime.reconcile(retained.service), null)
  assert.ok(retained.calls.every((args) => !args.includes('rm')))
})

test('malformed process snapshots and completed provisioning records never enable recovery', async () => {
  assert.equal(
    await owners.dead(old, self, { readProcess: async () => 'unreadable' }),
    false
  )
  const provisioning = require('../../../api/lib/service-provisioning')
  assert.deepEqual(
    await provisioning.eligibility(
      {
        status: 'failed',
        type: 'postgresql',
        imageMetadata: {
          provisioning: { version: 1, state: 'completed', owner: old }
        }
      },
      self
    ),
    { eligible: false }
  )
})

test('container adoption rejects a different network or data path before starting anything', async () => {
  for (const mismatch of ['network', 'data-path']) {
    const c = existing()
    c.State = { Running: false, Status: 'exited' }
    if (mismatch === 'network') c.NetworkSettings.Networks = { other: {} }
    else
      c.Config.Env = c.Config.Env.map((x) =>
        x.startsWith('PGDATA=') ? 'PGDATA=/tmp/other' : x
      )
    const f = fixture({ container: c, volume: {} })
    await assert.rejects(f.runtime.reconcile(f.service), /does not match/)
    assert.equal(
      f.calls.some((args) => args[0] === 'start'),
      false
    )
  }
})
test('credential verification authenticates over TCP and rejects authentication failures', async () => {
  const commands = []
  const success = create(async (args) => {
    commands.push(args)
    return '1\n'
  })
  const service = fixture().service
  await success.verifyCredentials(service)
  assert.ok(commands[0].includes('127.0.0.1'))
  assert.ok(commands[0].includes('SELECT 1'))
  assert.ok(commands[0].includes('-w'))
  await assert.rejects(
    create(async () => 'authentication failed').verifyCredentials(service, {
      attempts: 1
    }),
    (error) => !error.message.includes('fixture-secret')
  )
  await assert.rejects(
    create(async () => null).verifyCredentials(service, { attempts: 1 })
  )
  await create(async () => 'PONG\n').verifyCredentials({
    ...service,
    type: 'redis'
  })
})
test('verified self runtime requires Docker container identity, not just an arbitrary shared hostname', () => {
  const { isSelf } = owners._private
  const c = { id: 'a'.repeat(64), hostname: 'a'.repeat(12), running: true }
  assert.equal(isSelf(c, 'a'.repeat(12)), true)
  assert.equal(isSelf({ ...c, hostname: 'host' }, 'host'), false)
  assert.equal(isSelf({ ...c, id: 'b'.repeat(64) }, c.hostname), false)
})

test('authenticated readiness tolerates bounded initialization before accepting the stored credentials', async () => {
  let calls = 0
  const runtime = create(async () => {
    if (++calls < 3) throw new Error('initializing')
    return '1'
  })
  await runtime.verifyCredentials(fixture().service, {
    attempts: 3,
    intervalMs: 0
  })
  assert.equal(calls, 3)
})
