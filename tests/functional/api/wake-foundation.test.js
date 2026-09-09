const { test } = require('sounding')
const assert = require('node:assert/strict')
const crypto = require('node:crypto')
let scenarioNumber = 0
function options() {
  return {
    transport: 'http',
    world: {
      name: 'configured-slipway',
      context: {
        deploymentTarget: { slug: `wake-foundation-${++scenarioNumber}` }
      }
    }
  }
}
async function fixture(sails, world, request) {
  await sails.helpers.wake.ensureSchema()
  const app = world.current.apps.web
  const token = `swk_${crypto.randomBytes(32).toString('hex')}`
  await sails.models.app
    .updateOne({ id: app.id })
    .set({ wakeEnabled: true, wakeSecret: token })
  const deployment = await sails.models.deployment
    .create({ app: app.id, environment: app.environment })
    .fetch()
  const api = request.withHeaders({ authorization: `Bearer ${token}` })
  return {
    app,
    token,
    deployment,
    api,
    scope: { appId: String(app.id), deploymentId: String(deployment.id) },
    db: sails.getDatastore('analytics')
  }
}
function event(id = 'event_12345678') {
  return {
    id,
    kind: 'pageview',
    occurredAt: Date.now(),
    path: '/pricing?token=never-store#secret',
    visitorId: 'visitor_12345678'
  }
}

test(
  'Wake persists scoped events separately, strips URL secrets, and deduplicates concurrent delivery',
  options(),
  async ({ sails, world, request }) => {
    const { api, scope, db, app } = await fixture(sails, world, request)
    assert.equal(sails.wakeStorageReady, true)
    const payload = { ...scope, events: [event()] }
    const responses = await Promise.all([
      api.post('/api/v1/wake/ingest', payload),
      api.post('/api/v1/wake/ingest', payload)
    ])
    assert.deepEqual(
      responses.map((r) => r.status),
      [200, 200]
    )
    assert.equal(
      responses.reduce((n, r) => n + r.data.accepted, 0),
      1
    )
    const result = await db.sendNativeQuery(
      'SELECT * FROM wake_events WHERE app=?',
      [String(app.id)]
    )
    assert.equal(result.rows.length, 1)
    assert.equal(result.rows[0].path, '/pricing')
    assert.equal(result.rows[0].environment, String(app.environment))
    assert.ok(!JSON.stringify(result.rows).includes('never-store'))
  }
)
test(
  'Wake rejects cross-app deployment scope, browser fields, revenue, and revoked credentials',
  options(),
  async ({ sails, world, request }) => {
    const { api, scope, app } = await fixture(sails, world, request)
    assert.equal(
      (
        await request.post('/api/v1/wake/ingest', {
          ...scope,
          events: [event()]
        })
      ).status,
      401
    )
    assert.equal(
      (
        await api.post('/api/v1/wake/ingest', {
          ...scope,
          deploymentId: '9999999',
          events: [event()]
        })
      ).status,
      401
    )
    for (const extra of [
      { kind: 'revenue', amount: 100 },
      { provenance: 'forged' },
      { properties: { password: 'secret' } },
      { occurredAt: Date.now() + 900000 }
    ]) {
      assert.equal(
        (
          await api.post('/api/v1/wake/ingest', {
            ...scope,
            events: [{ ...event(), ...extra }]
          })
        ).status,
        400
      )
    }
    assert.equal(
      (
        await api.post('/api/v1/wake/ingest', {
          ...scope,
          environment: 'forged',
          events: [event()]
        })
      ).status,
      400
    )
    await sails.models.app
      .updateOne({ id: app.id })
      .set({ wakeEnabled: false, wakeSecret: null })
    assert.equal(
      (await api.post('/api/v1/wake/ingest', { ...scope, events: [event()] }))
        .status,
      401
    )
  }
)
test(
  'Wake bounds real HTTP bodies and app budgets, and reports storage failure',
  options(),
  async ({ sails, world, request }) => {
    const { api, scope, db, app } = await fixture(sails, world, request)
    assert.equal(
      (
        await api.post('/api/v1/wake/ingest', {
          ...scope,
          events: [event()],
          huge: 'x'.repeat(70000)
        })
      ).status,
      413
    )
    assert.equal(
      (
        await api.post('/API/V1/WAKE/INGEST', {
          ...scope,
          events: [event()],
          huge: 'x'.repeat(70000)
        })
      ).status,
      413
    )
    const { budget } = require('../../../api/lib/wake-ingest')
    await budget(db, String(app.id), 0, 0)
    await db.sendNativeQuery(
      'UPDATE wake_budgets SET requests=119 WHERE app=?',
      [String(app.id)]
    )
    const results = await Promise.all([
      api.post('/api/v1/wake/ingest', {
        ...scope,
        events: [event('event_12345671')]
      }),
      api.post('/api/v1/wake/ingest', {
        ...scope,
        events: [event('event_12345672')]
      })
    ])
    assert.deepEqual(results.map((r) => r.status).sort(), [200, 429])
    sails.wakeStorageReady = false
    assert.equal(
      (await api.post('/api/v1/wake/ingest', { ...scope, events: [event()] }))
        .status,
      503
    )
  }
)
test(
  'Wake registration reports foundation-only readiness and runtime config clears disabled credentials',
  options(),
  async ({ sails, world, request }) => {
    const { api, scope, app, token } = await fixture(sails, world, request)
    const registered = await api.post('/api/v1/wake/register', {
      ...scope,
      hookVersion: '0.0.9',
      protocol: 1
    })
    assert.equal(registered.status, 200)
    assert.deepEqual(registered.data, {
      protocol: 1,
      collectionReady: false,
      leaseMs: 0
    })
    const config = await sails.helpers.wake.runtimeConfig.with(scope)
    assert.equal(config.SLIPWAY_WAKE_SECRET, token)
    assert.equal(config.SLIPWAY_WAKE_DEPLOYMENT_ID, scope.deploymentId)
    await sails.models.app.updateOne({ id: app.id }).set({ wakeEnabled: false })
    const disabled = await sails.helpers.wake.runtimeConfig.with(scope)
    assert.equal(disabled.SLIPWAY_WAKE_SECRET, '')
    assert.equal(disabled.SLIPWAY_WAKE_ENABLED, 'false')
  }
)

test(
  'Wake manager authorization rotates and revokes secrets without returning them',
  options(),
  async ({ sails, world, request }) => {
    const { app, scope, api } = await fixture(sails, world, request)
    const current = world.current
    const input = {
      projectSlug: current.projects.deploymentTarget.slug,
      envSlug: current.environments.production.slug,
      appSlug: app.slug,
      enabled: true
    }
    await assert.rejects(
      sails.helpers.wake.setEnabled.with({ ...input, req: {} }),
      (error) => error.code === 'forbidden'
    )
    const req = {
      session: { userId: current.users.genesisUser.id },
      ip: '127.0.0.1'
    }
    await api.post('/api/v1/wake/register', {
      ...scope,
      hookVersion: '0.0.9',
      protocol: 1
    })
    const result = await sails.helpers.wake.setEnabled.with({ ...input, req })
    assert.deepEqual(result, { enabled: true, requiresRedeploy: true })
    assert.equal(
      (await sails.helpers.wake.resolveState(String(app.id))).state,
      'waiting_for_runtime'
    )
    assert.equal(
      (await api.post('/api/v1/wake/ingest', { ...scope, events: [event()] }))
        .status,
      401
    )
    const enabled = await sails.models.app.findOne({ id: app.id }).decrypt()
    assert.match(enabled.wakeSecret, /^swk_[a-f0-9]{64}$/)
    const raw = await sails
      .getDatastore()
      .sendNativeQuery('SELECT wake_secret FROM apps WHERE id=?', [app.id])
    assert.notEqual(raw.rows[0].wake_secret, enabled.wakeSecret)
    await sails.helpers.wake.setEnabled.with({ ...input, req, enabled: false })
    const disabled = await sails.models.app.findOne({ id: app.id }).decrypt()
    assert.equal(disabled.wakeSecret, null)
    assert.deepEqual(await sails.helpers.wake.resolveState(String(app.id)), {
      state: 'disabled'
    })
  }
)

test(
  'Wake runtime registers with real Sails HTTP independently of Lookout and receives a collection lease',
  options(),
  async ({ sails, world, request }) => {
    const { app, scope, token } = await fixture(sails, world, request)
    const runtime = require('../../../packages/hook/lib/wake-runtime')(
      sails,
      {
        enabled: true,
        ...scope,
        secret: token,
        ingestUrl: `http://127.0.0.1:${
          sails.hooks.http.server.address().port
        }/api/v1/wake/ingest`
      },
      '0.0.9'
    )
    try {
      runtime.start()
      const deadline = Date.now() + 5000
      while (runtime.getStatus() === 'connecting' && Date.now() < deadline)
        await new Promise((resolve) => setTimeout(resolve, 20))
      assert.equal(runtime.getStatus(), 'collecting')
      assert.equal(
        (await sails.helpers.wake.resolveState(String(app.id))).state,
        'collecting'
      )
    } finally {
      runtime.stop()
    }
  }
)

test(
  'Wake schema preparation is repeat-safe and preserves accepted events',
  options(),
  async ({ sails, world, request }) => {
    const { scope, api, app, db } = await fixture(sails, world, request)
    assert.equal(
      (await api.post('/api/v1/wake/ingest', { ...scope, events: [event()] }))
        .status,
      200
    )
    await sails.helpers.wake.ensureAppSchema()
    await sails.helpers.wake.ensureSchema()
    await sails.helpers.wake.ensureSchema()
    const rows = await db.sendNativeQuery(
      'SELECT * FROM wake_events WHERE app=?',
      [String(app.id)]
    )
    assert.equal(rows.rows.length, 1)
  }
)

test(
  'Wake current privacy settings strip in-flight identities and exclude newly blocked paths',
  options(),
  async ({ sails, world, request }) => {
    const { api, scope, db, app } = await fixture(sails, world, request)
    await sails.models.app.updateOne({ id: app.id }).set({
      wakeSettings: { mode: 'cookieless', excludedPaths: ['/private*'] }
    })
    const response = await api.post('/api/v1/wake/ingest', {
      ...scope,
      events: [
        {
          ...event('event_privacy_1'),
          sessionId: 'session_12345678',
          hostUserId: 'creator-id',
          provenance: 'browser'
        }
      ]
    })
    assert.equal(response.status, 200)
    const rows = await db.sendNativeQuery(
      'SELECT * FROM wake_events WHERE app=?',
      [String(app.id)]
    )
    assert.equal(rows.rows[0].visitor_id, null)
    assert.equal(rows.rows[0].session_id, null)
    assert.equal(rows.rows[0].host_user_id, null)
    const excluded = await api.post('/api/v1/wake/ingest', {
      ...scope,
      events: [{ ...event('event_privacy_2'), path: '/private/account' }]
    })
    assert.equal(excluded.status, 200)
    assert.equal(excluded.data.accepted, 0)
  }
)
