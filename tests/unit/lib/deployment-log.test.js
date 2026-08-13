const { test } = require('sounding')

const { appendTimestampedChunk } = require('../../../api/lib/deployment-log')

test('deployment log timestamps logical lines across arbitrary chunks', ({
  expect
}) => {
  const firstTime = '2026-08-13T09:10:11.120Z'
  const secondTime = '2026-08-13T09:10:12.340Z'
  let logs = appendTimestampedChunk('', 'Building lay', firstTime)
  logs = appendTimestampedChunk(logs, 'er\nNext line\n', secondTime)

  expect(logs).toBe(`${firstTime} Building layer\n${secondTime} Next line\n`)
})

test('deployment log preserves historical lines and existing timestamps', ({
  expect
}) => {
  const time = '2026-08-13T09:10:11.120Z'
  const existingTime = '2026-08-13T09:09:00.000Z'
  let logs = appendTimestampedChunk('Historical partial', ' line\n', time)
  logs = appendTimestampedChunk(
    logs,
    `${existingTime} Already canonical\nFresh\n`,
    time
  )

  expect(logs).toBe(
    `Historical partial line\n${existingTime} Already canonical\n${time} Fresh\n`
  )
})

test('deployment log preserves deliberate blank lines without fake events', ({
  expect
}) => {
  const time = '2026-08-13T09:10:11.120Z'
  const logs = appendTimestampedChunk('', '\nBuild failed\n\n', time)

  expect(logs).toBe(`\n${time} Build failed\n\n`)
})
