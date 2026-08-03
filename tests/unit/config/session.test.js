const { test } = require('sounding')

const { session } = require('../../../config/session')

test('Slipway sessions never collide with a proxied host Sails app', ({
  expect
}) => {
  expect(session.name).toBe('slipway.sid')
})
