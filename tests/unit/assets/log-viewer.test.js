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

test('log viewer groups stack context with its parent error', async ({
  expect
}) => {
  const { buildLogEvents, filterLogEvents, serializeLogEvents } = await import(
    '../../../assets/js/lib/log-viewer.mjs'
  )
  const lines = [
    '2026-08-04T14:03:12.798Z Error: EMAXBUFFER',
    '2026-08-04T14:03:12.799Z Note that this error may be delayed.',
    '2026-08-04T14:03:12.800Z     at Timeout.<anonymous> (/app/Upstream.js:86:15)',
    '2026-08-04T14:03:12.801Z     code: EMAXBUFFER',
    '2026-08-04T14:03:13.000Z info: server recovered'
  ]
  const events = buildLogEvents(lines)

  expect(events.length).toBe(2)
  expect(events[0].level).toBe('error')
  expect(events[0].entries.length).toBe(4)
  expect(filterLogEvents(events, { level: 'error' })[0].entries.length).toBe(4)
  expect(filterLogEvents(events, { query: 'Upstream.js' }).length).toBe(1)
  expect(serializeLogEvents([events[0]])).toBe(lines.slice(0, 4).join('\n'))
})

test('log viewer preserves blank context, ANSI-free display, and raw copy', async ({
  expect
}) => {
  const { buildLogEvents } = await import(
    '../../../assets/js/lib/log-viewer.mjs'
  )
  const lines = [
    '2026-08-04T14:03:12.798Z \u001b[31mError: upload failed\u001b[0m',
    '',
    '2026-08-04T14:03:12.799Z     at upload (/app/upload.js:20:3)'
  ]
  const [event] = buildLogEvents(lines)

  expect(event.entries.length).toBe(3)
  expect(event.entries[0].message).toBe('Error: upload failed')
  expect(event.raw).toBe(lines.join('\n'))
})

test('log viewer counts and filters complete events by severity', async ({
  expect
}) => {
  const { buildLogEvents, filterLogEvents } = await import(
    '../../../assets/js/lib/log-viewer.mjs'
  )
  const events = buildLogEvents([
    '2026-08-04T14:03:10Z info: server ready',
    '2026-08-04T14:03:11Z warning: disk at 80%',
    '2026-08-04T14:03:12Z Error: upload failed'
  ])

  expect(filterLogEvents(events, { level: 'warning' }).length).toBe(1)
  expect(filterLogEvents(events, { query: 'upload' }).length).toBe(1)
  expect(filterLogEvents(events, { query: 'missing' }).length).toBe(0)
})
