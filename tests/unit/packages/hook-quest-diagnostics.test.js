const { test } = require('sounding')
const {
  normalizeQuestDiagnostic
} = require('../../../packages/hook/lib/quest-diagnostics')

test('Quest diagnostics are useful, bounded, redacted, and backward compatible', ({
  expect
}) => {
  const trace = normalizeQuestDiagnostic(
    {
      diagnostic:
        '\u001b[31mError: database exploded\u001b[0m\n    at sendIssueNotifications (/app/scripts/send-issue-notifications.js:12:3)\nAPI_TOKEN=visible-token Bearer visible-token',
      stack: 'Error: Job exited with code 1\n    at executor.js:143:23'
    },
    {
      environment: { API_TOKEN: 'visible-token' },
      maxBytes: 1024
    }
  )

  expect(trace).toContain('sendIssueNotifications')
  expect(trace).toContain('Quest runner:')
  expect(trace).toContain('executor.js')
  expect(trace.includes('visible-token')).toBe(false)
  expect(trace.includes('\u001b')).toBe(false)
  expect(Buffer.byteLength(trace) <= 1024).toBe(true)

  expect(
    normalizeQuestDiagnostic({ stack: 'Error: older Quest payload' })
  ).toBe('Error: older Quest payload')
  expect(normalizeQuestDiagnostic({ message: 'no trace available' })).toBe(null)
})
