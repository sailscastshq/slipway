const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const os = require('node:os')
const Database = require('better-sqlite3')
const host = require('../../api/lib/upgrade-host-controller')
const createBroker = require('../../api/lib/upgrade-broker')
const image = `ghcr.io/sailscastshq/slipway@sha256:${'a'.repeat(64)}`
function fixture(run) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'upgrade-broker-'))
  fs.chmodSync(directory, 0o700)
  const source = path.join(directory, 'source')
  fs.mkdirSync(source)
  for (const name of ['app.db', 'observability.db', 'analytics.db', 'stash.db'])
    new Database(path.join(source, name)).close()
  const reviewed = host.plan({
    sourceDirectory: source,
    sourceVersion: 'fresh',
    image,
    instanceId: 'fixture-instance',
    containerId: 'a'.repeat(64)
  })
  const calls = [],
    containers = new Map()
  let prepared
  const docker = async (method, route, body) => {
    calls.push({ method, route, body })
    if (route.startsWith('/containers/create')) {
      const input = JSON.parse(fs.readFileSync(body.Cmd.at(-1), 'utf8'))
      assert.equal(fs.statSync(body.Cmd.at(-1)).mode & 0o777, 0o600)
      assert.equal(body.HostConfig.PidMode, 'host')
      assert.equal(body.HostConfig.NetworkMode, 'none')
      assert.ok(!JSON.stringify(body).includes('synthetic-secret'))
      assert.ok(!JSON.stringify(body).includes('signature'))
      if (input.grant) {
        assert.equal(input.grant.claims.actorUserId, 1)
        assert.equal(input.grant.claims.instanceId, reviewed.instanceId)
        assert.equal(input.grant.claims.reviewHash, reviewed.reviewHash)
      }
      const id = 'fixture-' + containers.size
      containers.set(id, { input, body, started: false })
      return { Id: id }
    }
    const id = route.split('/')[2].split('?')[0]
    const entry = containers.get(id)
    if (route.endsWith('/json'))
      return {
        Name: '/' + entry.input.controllerContainer,
        Config: { Labels: entry.body.Labels },
        State: {
          Running: entry.started,
          Status: entry.started ? 'running' : 'created'
        }
      }
    if (route.endsWith('/start')) {
      entry.started = true
      return null
    }
    if (route.includes('/wait?')) return { StatusCode: 0 }
    if (route.includes('/logs?')) {
      if (entry.input.operation === 'plan')
        return { success: true, ...reviewed }
      if (entry.input.operation === 'prepare') {
        prepared = host.prepare({
          reviewed,
          approval: reviewed.reviewHash,
          directory,
          maxBytes: 50 * 1024 * 1024
        })
        return { success: true, ...prepared }
      }
      assert.fail('resume must not be synchronously waited or logged')
    }
    if (method === 'DELETE') return null
    assert.fail('unexpected Docker operation')
  }
  const broker = createBroker({
    docker,
    directory,
    container: 'slipway',
    instanceId: reviewed.instanceId,
    actor: { id: 1, isGenesisUser: true, authVersion: 'fixture-auth' },
    secret: 'synthetic-secret'.repeat(4)
  })
  return Promise.resolve()
    .then(() =>
      run({
        broker,
        reviewed,
        calls,
        containers,
        directory,
        prepared: () => prepared
      })
    )
    .finally(() => fs.rmSync(directory, { recursive: true, force: true }))
}
test('broker creates a durable accepted checkpoint before starting its independent controller', () =>
  fixture(async ({ broker, reviewed, containers, prepared }) => {
    assert.equal((await broker.plan(image)).reviewHash, reviewed.reviewHash)
    const accepted = await broker.apply({
      image,
      approval: reviewed.reviewHash,
      requestedInstance: reviewed.instanceId
    })
    assert.equal(host.read(prepared().filename).phase, 'reviewed')
    const execution = [...containers.values()].find(
      (entry) => entry.input.operation === 'resume'
    )
    assert.equal(execution.started, false)
    assert.equal(accepted.result.manifestHash, reviewed.identity.hash)
    assert.equal(broker.latest().id, accepted.result.id)
    assert.equal(broker.status(accepted.result.id).phase, 'reviewed')
    await broker.start(accepted.result.id)
    await broker.start(accepted.result.id)
    assert.equal(execution.started, true)
  }))
test('broker rejected approvals never prepare or launch migration work', () =>
  fixture(async ({ broker, reviewed, containers }) => {
    await assert.rejects(
      broker.apply({
        image,
        approval: 'b'.repeat(64),
        requestedInstance: reviewed.instanceId
      }),
      { code: 'upgradeHostApproval' }
    )
    assert.ok(
      [...containers.values()].every(
        (entry) => entry.input.operation === 'plan'
      )
    )
    await assert.rejects(
      broker.apply({
        image,
        approval: reviewed.reviewHash,
        requestedInstance: 'other'
      }),
      { code: 'upgradeHostApproval' }
    )
    assert.throws(() => broker.status('../request'), {
      code: 'upgradeHostTarget'
    })
  }))
test('a disconnected response discards only its unstarted helper and retains reviewed recovery state', () =>
  fixture(async ({ broker, reviewed, calls, prepared }) => {
    const accepted = await broker.apply({
      image,
      approval: reviewed.reviewHash,
      requestedInstance: reviewed.instanceId
    })
    await accepted.cancel()
    assert.equal(host.read(prepared().filename).phase, 'reviewed')
    assert.ok(
      calls.some(
        (call) =>
          call.method === 'DELETE' &&
          call.route.includes(accepted.result.controllerId)
      )
    )
  }))
test('broker rejects missing instance launch context or non-founder authority', () => {
  assert.throws(() => createBroker({}), { code: 'upgradeHostRequired' })
  assert.throws(
    () =>
      createBroker({
        directory: '/fixture',
        container: 'slipway',
        instanceId: 'fixture',
        actor: { id: 1, isGenesisUser: false, authVersion: '' }
      }),
    { code: 'upgradeHandoffRejected' }
  )
})
