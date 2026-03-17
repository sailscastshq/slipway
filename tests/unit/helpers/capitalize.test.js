const { test } = require('sounding')

test('capitalize formats a single word for the UI', async ({
  sails,
  expect
}) => {
  expect(sails.helpers.capitalize('hello')).toBe('Hello')
})

test('capitalize formats hyphenated names for the UI', async ({
  sails,
  expect
}) => {
  expect(sails.helpers.capitalize('launch-pad')).toBe('Launch Pad')
})
