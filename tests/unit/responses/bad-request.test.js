const { test } = require('sounding')
const assert = require('node:assert/strict')
const badRequest = require('../../../api/responses/badRequest')

function responseContext(headers = {}) {
  const events = []
  const req = {
    session: {},
    header: (name) => headers[name],
    get: (name) => (name === 'Referrer' ? '/fixture-form' : undefined),
    _sails: {
      inertia: {
        handleBadRequest(...args) {
          events.push(['delegate', ...args])
        }
      }
    }
  }
  const res = {
    status(code) {
      events.push(['status', code])
      return this
    },
    set(name, value) {
      events.push(['header', name, value])
      return this
    },
    send(body) {
      events.push(['send', body])
      return this
    },
    json(body) {
      events.push(['json', body])
      return this
    }
  }
  return { req, res, events }
}
function serializableValidationError() {
  const error = new Error('internal fixture validation details')
  error.problems = ['"code" is required']
  error.toJSON = () => {
    throw new Error('Response must not serialize arbitrary error details')
  }
  return error
}

test('Serializable API validation errors always finish as safe 400 JSON', async () => {
  const context = responseContext()
  badRequest.call(context, serializableValidationError())
  assert.deepEqual(context.events, [
    ['status', 400],
    ['json', { message: 'Invalid request parameters.' }]
  ])
  assert.deepEqual(context.req.session, {})
})

test('Serializable Inertia validation errors retain their 303 redirect and field errors', async () => {
  const context = responseContext({ 'X-Inertia': 'true' })
  badRequest.call(context, serializableValidationError())
  assert.deepEqual(context.events, [
    ['status', 303],
    ['header', 'Location', '/fixture-form'],
    ['send', 'See Other']
  ])
  assert.ok(context.req.session.errors.code.length > 0)
})

test('Precognition and ordinary bad-request payloads retain their existing handler', async () => {
  const precognition = responseContext({
    'X-Inertia': 'true',
    Precognition: 'true'
  })
  const validation = serializableValidationError()
  badRequest.call(precognition, validation)
  assert.deepEqual(precognition.events, [
    ['delegate', precognition.req, precognition.res, validation]
  ])
  for (const data of [
    undefined,
    'Invalid fixture command',
    { message: 'Invalid fixture value' },
    new Error('ordinary fixture error')
  ]) {
    const context = responseContext()
    badRequest.call(context, data)
    assert.deepEqual(context.events, [
      ['delegate', context.req, context.res, data]
    ])
  }
})
