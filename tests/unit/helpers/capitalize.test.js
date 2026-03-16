const test = require('node:test')
const assert = require('node:assert/strict')

const capitalize = require('../../../api/helpers/capitalize')

test('sails.helpers.capitalize capitalizes a single word', () => {
  const value = capitalize.fn(
    { inputString: 'hello' },
    {
      success: (result) => result,
    }
  )

  assert.equal(value, 'Hello')
})

test('sails.helpers.capitalize formats hyphenated names for the UI', () => {
  const value = capitalize.fn(
    { inputString: 'launch-pad' },
    {
      success: (result) => result,
    }
  )

  assert.equal(value, 'Launch Pad')
})
