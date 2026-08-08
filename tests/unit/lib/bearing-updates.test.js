const { test } = require('sounding')
const { slugifyUpdateTitle } = require('../../../api/lib/bearing-updates')

test('Bearing update titles become stable human-readable slugs', ({
  expect
}) => {
  expect(slugifyUpdateTitle('Calmer notifications have shipped!')).toBe(
    'calmer-notifications-have-shipped'
  )
  expect(slugifyUpdateTitle('Café & reliability')).toBe('cafe-and-reliability')
  expect(slugifyUpdateTitle('---')).toBe('update')
})
