const { test } = require('sounding')

const generateRouteConfig = require('../../../../api/helpers/caddy/generate-route-config')

test('generated Caddy config rewrites host Bridge paths to the control plane', ({
  expect
}) => {
  const handlers = generateRouteConfig._private.bridgeHandlers({
    app: { slug: 'web', routePath: '/academy' },
    projectSlug: 'durable-ui',
    environmentSlug: 'production',
    controlPlaneUpstream: 'slipway:1337'
  })

  expect(handlers[0].routes[0].match[0].path).toEqual([
    '/academy/bridge/launch'
  ])
  expect(handlers[0].routes[0].handle[0].uri).toBe('/bridge/launch')
  expect(handlers[1].routes[0].handle[0].strip_path_prefix).toBe(
    '/academy/bridge/_assets'
  )
  expect(handlers[2].routes[0].handle[1].uri).toBe(
    '/projects/durable-ui/environments/production/apps/web/bridge{http.request.uri.path}'
  )
  expect(handlers[2].routes[0].handle[2].upstreams).toEqual([
    { dial: 'slipway:1337' }
  ])
})
