const { test } = require('sounding')
const countLogLines = require('../../../api/lib/count-log-lines')

test('log line counts preserve blank, Unicode whitespace and final-line semantics', ({
  expect
}) => {
  for (const text of [
    '',
    '\n\r\n \t\n',
    'one',
    'one\n',
    'one\r\ntwo\n',
    '\u00a0\n\ufeff\n\u2028\n',
    'a\u2028b\n\u200bc',
    'out\n' + 'err\n',
    'out' + 'err\n'
  ]) {
    expect(countLogLines(text)).toBe(
      text.split('\n').filter((line) => line.trim()).length
    )
  }
})

test('a burst with 89146 lines retains its exact count', ({ expect }) => {
  expect(
    countLogLines('2026-10-20T11:00:00Z synthetic log\n'.repeat(89146))
  ).toBe(89146)
})
