const { test } = require('sounding')
const {
  injectBearingWidget
} = require('../../../packages/hook/lib/bearing-widget')

test('Bearing widget injection is same-origin, bounded, and idempotent', ({
  expect
}) => {
  const headers = new Map([
    ['content-type', 'text/html; charset=utf-8'],
    ['content-length', '42'],
    ['etag', 'stale-after-injection']
  ])
  const response = {
    statusCode: 200,
    getHeader: (name) => headers.get(name),
    removeHeader: (name) => headers.delete(name)
  }
  const request = { method: 'GET' }
  const args = injectBearingWidget(
    request,
    response,
    ['<!doctype html><body>Hello</body>'],
    { routePrefix: '/academy' }
  )

  expect(args[0]).toContain('src="/academy/_slipway/bearing/bootstrap.js"')
  expect(headers.has('content-length')).toBe(false)
  expect(headers.has('etag')).toBe(false)
  expect(injectBearingWidget(request, response, args, {})[0]).toBe(args[0])
})

test('Bearing widget injection respects restrictive CSP and non-HTML responses', ({
  expect
}) => {
  const response = (headers) => ({
    statusCode: 200,
    getHeader: (name) => headers[name],
    removeHeader: () => {}
  })
  const body = '<body>Hello</body>'

  expect(
    injectBearingWidget(
      { method: 'GET' },
      response({
        'content-type': 'text/html',
        'content-security-policy': "script-src 'nonce-private'"
      }),
      [body],
      {}
    )[0]
  ).toBe(body)
  expect(
    injectBearingWidget(
      { method: 'GET' },
      response({ 'content-type': 'application/json' }),
      [body],
      {}
    )[0]
  ).toBe(body)
})
