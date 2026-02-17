const { describe, it } = require('node:test')
const assert = require('node:assert/strict')
const { getSails } = require('../../util/get-sails')

describe('sails.helpers.capitalize()', () => {
  it('capitalizes single word correctly', async () => {
    const sails = await getSails()
    const capitalized = sails.helpers.capitalize('hello')
    assert.equal(capitalized, 'Hello')
  })

  it('capitalizes multiple words correctly', async () => {
    const sails = await getSails()
    const capitalized = sails.helpers.capitalize('the quick brown fox')
    assert.equal(capitalized, 'The quick brown fox')
  })
})
