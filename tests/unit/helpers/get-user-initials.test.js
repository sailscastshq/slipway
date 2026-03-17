const { test } = require('sounding')

test('getUserInitials derives initials from first and last name', async ({ sails, expect }) => {
  expect(sails.helpers.getUserInitials('Kelvin Omereshone')).toBe('KO')
})

test('getUserInitials derives initials from a single name', async ({ sails, expect }) => {
  expect(sails.helpers.getUserInitials('Kelvin')).toBe('KE')
})
