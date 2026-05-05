const { test } = require('sounding')

test('user initials use the first letters from a full name', async ({
  sails,
  expect
}) => {
  expect(sails.helpers.getUserInitials('Kelvin Omereshone')).toBe('KO')
})

test('user initials use the first two letters when only one name is present', async ({
  sails,
  expect
}) => {
  expect(sails.helpers.getUserInitials('Kelvin')).toBe('KE')
})
