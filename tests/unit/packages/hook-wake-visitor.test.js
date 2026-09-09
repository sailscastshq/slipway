const { test } = require('sounding')
const assert = require('node:assert/strict')
const visitor = require('../../../packages/hook/lib/wake-visitor')
const config = { appId: '42', secret: 'test-app-secret', routePath: '/academy' }
function response() {
  const headers = {}
  return {
    getHeader: (name) => headers[name],
    setHeader: (name, value) => {
      headers[name] = value
    },
    cookie: () => headers['set-cookie'].at(-1).split(';')[0]
  }
}

test('Wake visitor cookies are scoped, tamper-resistant, HttpOnly and expire after 90 days', () => {
  const res = response(),
    now = 1000000000000
  const initial = visitor.resolve(
    { headers: {} },
    res,
    config,
    { id: 'private-creator' },
    true,
    now
  )
  const cookie = res.cookie()
  assert.ok(
    res.getHeader('set-cookie')[0].includes('HttpOnly; SameSite=Lax; Secure')
  )
  assert.ok(res.getHeader('set-cookie')[0].includes('Path=/academy'))
  assert.equal(
    visitor.read(
      { headers: { cookie } },
      visitor.cookieName(config),
      config.secret,
      now
    ).visitor,
    initial.visitorId
  )
  const body = Buffer.from(
    cookie.split('=')[1].split('.')[0],
    'base64url'
  ).toString()
  assert.ok(!body.includes('private-creator'))
  assert.equal(
    visitor.read(
      { headers: { cookie: cookie + 'x' } },
      visitor.cookieName(config),
      config.secret,
      now
    ),
    null
  )
  assert.equal(
    visitor.read(
      { headers: { cookie: cookie.replace('sw_wake_42', 'sw_wake_43') } },
      'sw_wake_43',
      config.secret,
      now
    ),
    null
  )
  assert.equal(
    visitor.read(
      { headers: { cookie } },
      visitor.cookieName(config),
      config.secret,
      now + 90 * 86400000
    ),
    null
  )
})

test('Wake keeps anonymous continuity, renews idle sessions, and rotates on account switch and logout', () => {
  const now = 1000000000000,
    res = response()
  const anonymous = visitor.resolve(
    { headers: {} },
    res,
    config,
    null,
    false,
    now
  )
  const idle = visitor.resolve(
    { headers: { cookie: res.cookie() } },
    res,
    config,
    null,
    false,
    now + 31 * 60000
  )
  assert.equal(idle.visitorId, anonymous.visitorId)
  assert.notEqual(idle.sessionId, anonymous.sessionId)
  const authenticated = visitor.resolve(
    { headers: { cookie: res.cookie() } },
    res,
    config,
    { id: 'alice' },
    false,
    now + 32 * 60000
  )
  assert.equal(authenticated.visitorId, anonymous.visitorId)
  assert.equal(authenticated.changed, false)
  const switched = visitor.resolve(
    { headers: { cookie: res.cookie() } },
    res,
    config,
    { id: 'bob' },
    false,
    now + 33 * 60000
  )
  assert.equal(switched.changed, true)
  assert.notEqual(switched.visitorId, authenticated.visitorId)
  const logout = visitor.resolve(
    { headers: { cookie: res.cookie() } },
    res,
    config,
    null,
    false,
    now + 34 * 60000
  )
  assert.equal(logout.changed, true)
  assert.notEqual(logout.visitorId, switched.visitorId)
  const next = visitor.resolve(
    { headers: { cookie: res.cookie() } },
    res,
    config,
    null,
    false,
    now + 35 * 60000
  )
  assert.equal(next.changed, false)
  assert.equal(next.visitorId, logout.visitorId)
})
