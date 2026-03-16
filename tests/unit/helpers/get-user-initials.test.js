const test = require('node:test')
const assert = require('node:assert/strict')

const getUserInitials = require('../../../api/helpers/get-user-initials')

test('sails.helpers.getUserInitials uses first and last name initials', () => {
  assert.equal(getUserInitials.fn({ fullName: 'Kelvin Omereshone' }), 'KO')
})

test('sails.helpers.getUserInitials falls back to the first two letters', () => {
  assert.equal(getUserInitials.fn({ fullName: 'Kelvin' }), 'KE')
})
