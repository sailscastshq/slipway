const assert = require('node:assert/strict')
const { test } = require('sounding')
const dashboard = require('../../../api/lib/contracts/quest-diagnostics')
const hook = require('../../../packages/hook/lib/quest-diagnostics')

test('dashboard and independently packaged Quest diagnostic sanitizers retain parity', () => {
  for (const value of [
    '',
    '  exact \nvalue  ',
    'Bearer abc',
    'TOKEN=abc',
    '\u001b[31mwarning\u001b[0m',
    'known-secret'
  ]) {
    for (const preserveWhitespace of [true, false]) {
      const options = {
        preserveWhitespace,
        environment: { PRIVATE_KEY: 'known-secret' }
      }
      assert.equal(
        dashboard.sanitizeQuestDiagnostic(value, options),
        hook.sanitizeQuestDiagnostic(value, options)
      )
    }
  }
  assert.equal(
    dashboard.sanitizeQuestDiagnostic('  Bearer abc  ', {
      preserveWhitespace: true
    }),
    '  Bearer <redacted>  '
  )
})
