const assert = require('node:assert/strict')
const { test } = require('node:test')

const Tokens = require('csrf')

const { http } = require('../../../config/http')

test('bearer csrf bridge gives unsafe cli requests a valid csrf header', async () => {
  const req = {
    method: 'POST',
    headers: {
      authorization: 'Bearer test-token'
    },
    session: {}
  }

  await runBearerBridge(req)

  assert.ok(req.session.csrfSecret)
  assert.ok(req.headers['x-csrf-token'])
  assert.equal(
    new Tokens().verify(req.session.csrfSecret, req.headers['x-csrf-token']),
    true
  )
})

test('bearer csrf bridge leaves normal browser requests alone', async () => {
  const req = {
    method: 'POST',
    headers: {},
    session: {}
  }

  await runBearerBridge(req)

  assert.equal(req.session.csrfSecret, undefined)
  assert.equal(req.headers['x-csrf-token'], undefined)
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
