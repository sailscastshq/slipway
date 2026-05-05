const { test } = require('sounding')

test('display labels start a single word with a capital letter', async ({
  sails,
  expect
}) => {
  expect(sails.helpers.capitalize('hello')).toBe('Hello')
})

test('display labels turn hyphenated names into readable words', async ({
  sails,
  expect
}) => {
  expect(sails.helpers.capitalize('launch-pad')).toBe('Launch Pad')
})
