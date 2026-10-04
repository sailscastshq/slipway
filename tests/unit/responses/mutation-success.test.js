const { test } = require('sounding')
const assert = require('node:assert/strict')
const respond = require('../../../api/responses/mutationSuccess')
const returnPath = require('../../../api/lib/mutation-return-path')
function context(inertia, referrer) {
  const events = []
  const req = {
    protocol: 'https',
    header: (name) => (name === 'X-Inertia' ? inertia : undefined),
    get: (name) => (name === 'host' ? 'slipway.test' : referrer)
  }
  const res = Object.fromEntries(
    ['status', 'set', 'send', 'json'].map((method) => [
      method,
      (...args) => {
        events.push([method, ...args])
        return res
      }
    ])
  )
  return { req, res, events }
}
test('page success redirects without serializing values while REST retains JSON', () => {
  const data = { secret: 'fixture-sensitive-value' }
  const page = context(
    true,
    'https://slipway.test/projects/harbor?tab=settings'
  )
  respond.call(page, data)
  assert.deepEqual(page.events, [
    ['status', 303],
    ['set', 'Location', '/projects/harbor?tab=settings'],
    ['send', 'See Other']
  ])
  const rest = context(false)
  respond.call(rest, data)
  assert.deepEqual(rest.events, [
    ['status', 200],
    ['json', data]
  ])
})
test('mutation redirects accept same-origin paths and reject external referrers', () => {
  for (const referrer of [
    'https://evil.test/path',
    '//evil.test/path',
    'javascript:alert(1)',
    undefined
  ])
    assert.equal(returnPath(context(true, referrer).req), '/')
  assert.equal(
    returnPath(context(true, '/settings/cli-tokens').req),
    '/settings/cli-tokens'
  )
})

test('opt-in mutation validation handles field and plain-message errors without changing REST handlers', () => {
  const badRequest = require('../../../api/responses/mutationBadRequest')
  const page = context(true, '/settings/uploads')
  page.req.session = {}
  badRequest.call(page, { error: 'Private storage denied.', field: 'bucket' })
  assert.deepEqual(page.req.session.errors, {
    bucket: ['Private storage denied.']
  })
  assert.deepEqual(page.events, [
    ['status', 303],
    ['set', 'Location', '/settings/uploads'],
    ['send', 'See Other']
  ])
  const rest = context(false)
  rest.req._sails = {
    inertia: {
      handleBadRequest(req, res, data) {
        res.status(400).json(data)
      }
    }
  }
  badRequest.call(rest, { message: 'Invalid configuration.' })
  assert.deepEqual(rest.events, [
    ['status', 400],
    ['json', { message: 'Invalid configuration.' }]
  ])
})
