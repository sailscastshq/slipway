const { test } = require('node:test')
const assert = require('node:assert/strict')
const policy = require('../../../../api/policies/is-bridge-authenticated')
const resolve = require('../../../../api/helpers/bridge/resolve-request').fn
const exchange =
  require('../../../../api/controllers/api/v1/bridge/exchange').fn
function response() {
  return {
    code: 200,
    headers: {},
    status(n) {
      this.code = n
      return this
    },
    set(k, v) {
      this.headers[k] = v
      return this
    },
    json(v) {
      this.body = v
      return this
    },
    send(v) {
      this.body = v
      return this
    },
    redirect(v) {
      this.code = 302
      this.location = v
      return this
    }
  }
}
function req(extra = {}) {
  return {
    headers: {},
    query: {},
    get(name) {
      return this.headers[name.toLowerCase()]
    },
    allParams() {
      return {}
    },
    ...extra
  }
}

test('missing/null sessions deny JSON or redirect browser requests without granting access or creating sessions', async () => {
  const previous = global.sails
  global.sails = {
    helpers: { getInstanceUrl: async () => 'https://slipway.example' }
  }
  try {
    for (const session of [undefined, null])
      for (const wantsJSON of [true, false]) {
        const request = req({ session, wantsJSON })
        const res = response()
        let proceeds = 0
        await policy(request, res, () => {
          proceeds++
        })
        assert.equal(proceeds, 0)
        assert.equal(res.code, wantsJSON ? 401 : 302)
        if (wantsJSON) assert.equal(res.body.error, 'Unauthorized')
        else assert.equal(res.location, '/login')
        assert.equal(request.session, session)
        await assert.rejects(
          resolve({ req: request, projectSlug: 'project' }),
          (e) => e === 'forbidden'
        )
      }
  } finally {
    global.sails = previous
  }
})

test('stateless host-origin HTML and Inertia keep the normal authentication callback, never proceed', async () => {
  const old = {
    sails: global.sails,
    Project: global.Project,
    Environment: global.Environment,
    App: global.App
  }
  global.sails = {
    helpers: { getInstanceUrl: async () => 'https://slipway.example' }
  }
  global.Project = { findOne: async () => ({ id: 1 }) }
  global.Environment = { findOne: async () => ({ id: 2 }) }
  global.App = { findOne: async () => ({ id: 3, routePath: '/console' }) }
  try {
    for (const inertia of [false, true]) {
      const request = req({
        headers: {
          host: 'host.example',
          accept: 'text/html',
          'x-inertia': inertia ? 'true' : 'false'
        },
        query: { invite: 'fixture token' },
        allParams: () => ({
          slug: 'project',
          envSlug: 'production',
          appSlug: 'app'
        })
      })
      const res = response()
      await policy(request, res, () => assert.fail('must not authenticate'))
      assert.equal(res.code, inertia ? 409 : 302)
      assert.equal(
        inertia ? res.headers['X-Inertia-Location'] : res.location,
        '/console/_slipway/bridge?invite=fixture%20token'
      )
      assert.equal(request.session, undefined)
    }
  } finally {
    Object.assign(global, old)
  }
})

test('bearer credentials cannot substitute for the Bridge browser session', async () => {
  const old = global.sails
  global.sails = {
    helpers: { getInstanceUrl: async () => 'https://slipway.example' }
  }
  try {
    const request = req({
      headers: { authorization: 'Bearer fixture' },
      session: { bridgeAccessId: 1 },
      wantsJSON: true
    })
    const res = response()
    await policy(request, res, () =>
      assert.fail('bearer must not bypass policy')
    )
    assert.equal(res.code, 401)
  } finally {
    global.sails = old
  }
})

test('an authenticated operator still resolves through normal app authorization without a Bridge session', async () => {
  const old = global.sails
  const resolved = {
    user: { id: 1 },
    project: { slug: 'project' },
    environment: { slug: 'production' },
    app: { slug: 'app' }
  }
  const actor = { id: '1' }
  global.sails = {
    helpers: {
      resolveApp: {
        with: () => ({
          intercept() {
            return this
          },
          then(ok) {
            return Promise.resolve(resolved).then(ok)
          }
        })
      },
      bridge: { buildActor: { with: async () => actor } }
    }
  }
  try {
    const result = await resolve({
      req: req({ auth: { userId: 1 } }),
      projectSlug: 'project',
      appSlug: 'app'
    })
    assert.equal(result.actor, actor)
    assert.equal(result.bridgeHostOrigin, false)
    assert.equal(
      result.bridgeBasePath,
      '/projects/project/environments/production/apps/app/bridge'
    )
  } finally {
    global.sails = old
  }
})

test('revoked access and expired Bridge sessions are cleared and denied', async () => {
  const old = { BridgeAccess: global.BridgeAccess, App: global.App }
  global.BridgeAccess = { findOne: async () => null }
  try {
    for (const expired of [false, true]) {
      const session = {
        bridgeAccessId: 7,
        bridgeAppId: 3,
        bridgeAuthenticatedAt: expired ? 1 : Date.now(),
        bridgeCredentialHash: 'synthetic',
        bridgeHostOrigin: false
      }
      await assert.rejects(
        resolve({ req: req({ session }), projectSlug: 'project' }),
        (e) => e === 'forbidden'
      )
      assert.equal(session.bridgeAccessId, undefined)
      assert.equal(session.bridgeCredentialHash, undefined)
    }
  } finally {
    Object.assign(global, old)
  }
})

test('changing a host email does not silently rebind an existing invitation or bypass verification', async () => {
  const old = {
    sails: global.sails,
    App: global.App,
    BridgeAccess: global.BridgeAccess
  }
  const queries = []
  global.sails = { log: { warn: () => {} } }
  global.App = {
    findOne: () => ({
      decrypt: async () => ({
        id: 3,
        bridgeEnabled: true,
        bridgeSecret: 'synthetic-exchange-secret'
      })
    })
  }
  global.BridgeAccess = {
    findOne: async (criteria) => {
      queries.push(criteria)
      return criteria.email === 'old@example.test'
        ? { id: 7, status: 'active', hostUserId: 'owner' }
        : null
    }
  }
  const context = {
    req: req({ headers: { authorization: 'Bearer synthetic-exchange-secret' } })
  }
  try {
    await assert.rejects(
      exchange.call(context, {
        appId: '3',
        hostUser: {
          id: 'owner',
          email: 'new@example.test',
          emailVerified: true
        }
      }),
      (e) => e === 'forbidden'
    )
    assert.deepEqual(queries, [{ app: 3, email: 'new@example.test' }])
    await assert.rejects(
      exchange.call(context, {
        appId: '3',
        hostUser: {
          id: 'other',
          email: 'old@example.test',
          emailVerified: true
        }
      }),
      (e) => e === 'forbidden'
    )
    await assert.rejects(
      exchange.call(context, {
        appId: '3',
        hostUser: {
          id: 'owner',
          email: 'old@example.test',
          emailVerified: false
        }
      }),
      (e) => Boolean(e.badRequest)
    )
    assert.equal(queries.length, 2)
  } finally {
    Object.assign(global, old)
  }
})
