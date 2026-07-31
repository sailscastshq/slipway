const { test } = require('sounding')

const Tokens = require('csrf')

const { http } = require('../../../config/http')
const { routes } = require('../../../config/routes')

test('safe flag config route does not carry a CSRF override', ({ expect }) => {
  expect(routes['GET /api/v1/flags/apps/:appId']).toBe('api/v1/flag/get-config')
})

test('bearer csrf bridge gives unsafe cli requests a valid csrf header', async ({
  expect
}) => {
  const req = {
    method: 'POST',
    headers: {
      authorization: 'Bearer test-token'
    },
    session: {}
  }

  await runBearerBridge(req)

  expect(req.session.csrfSecret).toBeTruthy()
  expect(req.headers['x-csrf-token']).toBeTruthy()
  expect(
    new Tokens().verify(req.session.csrfSecret, req.headers['x-csrf-token'])
  ).toBe(true)
})

test('bearer csrf bridge leaves normal browser requests alone', async ({
  expect
}) => {
  const req = {
    method: 'POST',
    headers: {},
    session: {}
  }

  await runBearerBridge(req)

  expect(req.session.csrfSecret).toBe(undefined)
  expect(req.headers['x-csrf-token']).toBe(undefined)
})

function runBearerBridge(req) {
  return new Promise((resolve, reject) => {
    http.middleware.bearerTokenCsrfBridge(req, {}, (error) => {
      if (error) {
        reject(error)
        return
      }

      resolve()
    })
  })
}
