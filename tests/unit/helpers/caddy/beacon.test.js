const { test } = require('sounding')
const assert = require('node:assert/strict')
const route = require('../../../../api/lib/beacon/caddy-routes')
const update = require('../../../../api/helpers/caddy/update-route')._private
const page = require('../../../../api/lib/beacon/public-page')

test('Beacon Caddy JSON and Docker labels preserve root and prefixed app namespaces', () => {
  for (const routePath of ['/', '/academy']) {
    const app = {
      id: 1,
      slug: 'web',
      routePath,
      beaconPublicEnabled: true,
      containerName: 'web',
      port: 1337
    }
    const input = {
      app,
      projectSlug: 'harbor',
      environmentSlug: 'production',
      controlPlaneUpstream: 'slipway:1337'
    }
    const handlers = route.handlers(input)
    const base = routePath === '/' ? '' : routePath
    assert.deepEqual(
      handlers.map((handler) => handler.routes[0].match[0].path[0]),
      [
        base + '/_slipway/beacon/_assets/*',
        base + '/beacon',
        base + '/beacon/*'
      ]
    )
    assert.equal(
      handlers[1].routes[0].handle[1].uri,
      '/_slipway/beacon/host/harbor/production/web{http.request.uri.path}'
    )
    assert.equal(
      handlers[0].routes[0].handle[0].strip_path_prefix,
      base + '/_slipway/beacon/_assets'
    )
    const labels = update.buildRouteLabels({ ...input, routableApps: [app] })
    assert(labels.includes(`caddy.handle_1=${base}/beacon`))
    assert(labels.includes(`caddy.handle_2=${base}/beacon/*`))
    assert(
      labels.indexOf(`caddy.handle_1=${base}/beacon`) <
        labels.indexOf(`caddy.handle_3=${base ? base + '*' : '/*'}`)
    )
    assert.deepEqual(update.routeUpstreams([app], input.controlPlaneUpstream), [
      'web:1337',
      'slipway:1337'
    ])
    const disabled = update.buildRouteLabels({
      ...input,
      routableApps: [{ ...app, beaconPublicEnabled: false }]
    })
    assert.equal(
      disabled.some((value) => value.includes('/beacon')),
      false
    )
  }
})

test('Beacon public config rejects workers, reserved mounts and app-route collisions', () => {
  assert.equal(page.enabled('invalid'), false)
  assert.equal(page.enabled('{"enabled":"true"}'), false)
  assert.equal(page.enabled('{"enabled":true}'), true)
  for (const routePath of [null, '/bridge', '/bearing', '/beacon', '/a/../b']) {
    assert(page.conflict({ id: 1, routePath }, []))
  }
  assert(
    page.conflict({ id: 1, routePath: '/' }, [
      { id: 2, routePath: '/beacon/nested' }
    ])
  )
  assert.equal(
    page.conflict({ id: 1, routePath: '/' }, [
      { id: 2, routePath: '/beaconish' }
    ]),
    null
  )
  assert.equal(
    page.conflict({ id: 1, routePath: '/academy' }, [
      { id: 2, routePath: '/' }
    ]),
    null
  )
  assert(
    page.conflict(
      { id: 1, routePath: '/academy', healthPath: '/beacon/health' },
      []
    )
  )
})
