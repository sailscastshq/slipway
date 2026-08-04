const { test } = require('sounding')

test('log viewer parses a 500 error without generating markup', async ({
  expect
}) => {
  const { parseLogLine } = await import('../../../assets/js/lib/log-viewer.mjs')
  const raw =
    '2026-08-04T14:03:12.798288519Z POST /api/v1/upload 500 Error: EMAXBUFFER'
  const entry = parseLogLine(raw)

  expect(entry.raw).toBe(raw)
  expect(entry.timestamp).toBe('2026-08-04T14:03:12.798288519Z')
  expect(entry.time).toBe('14:03:12.798')
  expect(entry.level).toBe('error')
  expect(entry.statusCodes).toEqual([500])
  expect(entry.segments.map((segment) => segment.text).join('')).toBe(
    'POST /api/v1/upload 500 Error: EMAXBUFFER'
  )
  expect(JSON.stringify(entry.segments).includes('<span')).toBe(false)
  expect(JSON.stringify(entry.segments).includes('font-semibold')).toBe(false)
})

test('log viewer keeps user-controlled HTML as plain text', async ({
  expect
}) => {
  const { parseLogLine } = await import('../../../assets/js/lib/log-viewer.mjs')
  const entry = parseLogLine(
    '2026-08-04T14:03:12Z <img src=x onerror="alert(1)"> Error'
  )

  expect(entry.message).toBe('<img src=x onerror="alert(1)"> Error')
  expect(entry.segments.map((segment) => segment.text).join('')).toBe(
    '<img src=x onerror="alert(1)"> Error'
  )
})

test('log viewer classifies stack continuations and strips ANSI for display', async ({
  expect
}) => {
  const { parseLogLine } = await import('../../../assets/js/lib/log-viewer.mjs')
  const entry = parseLogLine(
    '2026-08-04T14:03:12.798Z \u001b[31m    at Timeout.<anonymous> (/app/Upstream.js:86:15)\u001b[0m'
  )

  expect(entry.level).toBe('continuation')
  expect(entry.continuation).toBe(true)
  expect(entry.message).toBe(
    '    at Timeout.<anonymous> (/app/Upstream.js:86:15)'
  )

  const numberedFrame = parseLogLine(
    '2026-08-04T14:03:12.798Z     at listOnTimeout (node:internal/timers:585:17)'
  )
  expect(numberedFrame.level).toBe('continuation')
  expect(numberedFrame.statusCodes).toEqual([])
  expect(numberedFrame.segments.map((segment) => segment.text).join('')).toBe(
    '    at listOnTimeout (node:internal/timers:585:17)'
  )
})

test('log viewer filters by severity and text while preserving raw copy', async ({
  expect
}) => {
  const { filterLogEntries, parseLogLine, serializeLogEntries } = await import(
    '../../../assets/js/lib/log-viewer.mjs'
  )
  const entries = [
    parseLogLine('2026-08-04T14:03:10Z info: server ready'),
    parseLogLine('2026-08-04T14:03:11Z warning: disk at 80%'),
    parseLogLine('2026-08-04T14:03:12Z Error: upload failed')
  ]

  expect(filterLogEntries(entries, { level: 'warning' }).length).toBe(1)
  const matches = filterLogEntries(entries, { query: 'upload' })
  expect(matches.length).toBe(1)
  expect(serializeLogEntries(matches)).toBe(
    '2026-08-04T14:03:12Z Error: upload failed'
  )
})
