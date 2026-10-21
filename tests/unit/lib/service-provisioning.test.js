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
      'POSTGRES_DB=db'
    ]
  },
  Mounts: [
    {
      Type: 'volume',
      Name: 'fixture-volume',
      Destination: '/var/lib/postgresql'
    }
  ],
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
