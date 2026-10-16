const { test } = require('sounding')
const assert = require('node:assert/strict')
const config = require('../../../../api/helpers/lookout/decoy-config')._private
const { observations } =
  require('../../../../api/helpers/lookout/collect-decoys')._private
const { handlers, labels, BODY } =
  require('../../../../api/helpers/caddy/decoy-handlers')._private
const app = {
  id: '42',
  name: 'API',
  environment: '7',
  routePath: '/api',
  healthPath: '/health',
  lookoutDecoys: { enabled: true, paths: ['/.env'], revision: 'a'.repeat(32) }
}

test('decoy allowlist is exact, off by default and rejects known route conflicts', () => {
  for (const value of [null, '{}', '{"enabled":true}', '{"enabled":"true"}'])
    assert.equal(config.parse(value).enabled, false)
  for (const path of [
    '/.git/config',
    '/.env*',
    '/%2eenv',
    '/../.env',
    '/bridge',
    '/.well-known'
  ])
    assert.match(
      config.validate(
        { ...app, lookoutDecoys: { ...app.lookoutDecoys, paths: [path] } },
        [app]
      ),
      /allowlist/
    )
  assert.equal(config.validate(app, [app]), null)
  assert.match(
    config.validate({ ...app, healthPath: '/.env' }, [app]),
    /health/
  )
  assert.match(
    config.validate(app, [
      app,
      { id: '43', routePath: '/api/.env', name: 'Sibling', hostPort: null }
    ]),
    /Sibling/
  )
  assert.match(
    config.validate({ ...app, routePath: '/_slipway' }, []),
    /reserved/
  )
  assert.match(config.validate({ ...app, routePath: null }, []), /Workers/)
  assert.match(
    config.validate({ ...app, routePath: '/BRIDGE' }, []),
    /reserved/
  )
  assert.match(
    config.validate({ ...app, routePath: '/api/../admin' }, []),
    /reserved/
  )
  assert.match(
    config.validate(app, [
      app,
      { id: '44', name: 'Uppercase sibling', routePath: '/API/.ENV' }
    ]),
    /sibling/
  )
})

test('decoy rendering preserves exact methods, body budget and disabled behavior', () => {
  assert.deepEqual(handlers([{ ...app, lookoutDecoys: config.OFF }]), [])
  assert.deepEqual(labels([{ ...app, lookoutDecoys: config.OFF }], 0), [])
  const route = handlers([app])[0].routes[0]
  assert.deepEqual(route.match[0].path, ['/api/.env'])
  assert.deepEqual(route.match[0].method, ['GET', 'HEAD'])
  const exact = new RegExp(
    route.match[0].vars_regexp['{http.request.orig_uri}'].pattern
  )
  assert.ok(exact.test('/api/.env'))
  assert.ok(exact.test('/api/.env?query=ignored'))
  for (const alias of [
    '/api/.ENV',
    '/api/%2eenv',
    '/api//.env',
    '/api/x/../.env'
  ])
    assert.equal(exact.test(alias), false)
  assert.equal(route.handle.at(-1).body, BODY)
  assert.ok(Buffer.byteLength(BODY) < 64)
  assert.equal(
    route.handle.some((h) => h.handler === 'reverse_proxy'),
    false
  )
})

test('proxy samples preserve real status, discard secrets and reject stale or malformed observations', () => {
  const now = Date.now()
  const log = {
    ts: now / 1000,
    status: 503,
    decoy_method: 'GET',
    slipway_decoy: config.token(app, '/.env'),
    request: {
      uri: '/.env?token=secret',
      headers: { Authorization: ['secret'] },
      client_ip: '1.2.3.4'
    },
    secret: 'never copy'
  }
  const raw = JSON.stringify(log)
  const records = observations(raw, [app], new Set(), now)
  assert.equal(records.length, 1)
  assert.equal(records[0].attributes.statusCode, 503)
  assert.equal(records[0].name, 'lookout.decoy_hit')
  assert.ok(!JSON.stringify(records).includes('secret'))
  assert.equal(
    observations(
      raw,
      [app],
      new Set([records[0].attributes.observationId]),
      now
    ).length,
    0
  )
  for (const patch of [
    { slipway_decoy: 'foreign' },
    { status: '200' },
    { decoy_method: 'POST' },
    { ts: 1 }
  ])
    assert.equal(
      observations(JSON.stringify({ ...log, ...patch }), [app], new Set(), now)
        .length,
      0
    )
  assert.equal(observations('x'.repeat(262145), [app]).length, 0)
  const burst = Array.from({ length: 1500 }, (_, i) =>
    JSON.stringify({ ...log, request: undefined, ts: now / 1000 - i / 1000 })
  ).join('\n')
  assert.ok(
    observations(burst.slice(-262144), [app], new Set(), now).length <= 50
  )
})
