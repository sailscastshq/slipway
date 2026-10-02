const { test } = require('sounding')

test('Quest keeps the same legacy event expanded across replayed and prepended snapshots', async ({
  expect
}) => {
  const { retainLegacyEventSelection } = await import(
    '../../../assets/js/lib/questHistory.mjs'
  )
  const history = [
    {
      eventId: 23,
      jobName: 'synthetic-index',
      event: 'failed',
      error: 'retained diagnostic'
    },
    { eventId: 22, jobName: 'synthetic-index', event: 'completed' }
  ]
  expect(retainLegacyEventSelection(history, 'synthetic-index', '23')).toBe(
    '23'
  )
  expect(
    retainLegacyEventSelection(
      JSON.parse(JSON.stringify(history)),
      'synthetic-index',
      '23'
    )
  ).toBe('23')
  expect(
    retainLegacyEventSelection(
      [
        { eventId: 24, jobName: 'synthetic-index', event: 'completed' },
        ...history
      ],
      'synthetic-index',
      '23'
    )
  ).toBe('23')
  expect(retainLegacyEventSelection(history, 'another-job', '23')).toBe('')
  expect(retainLegacyEventSelection(history, 'synthetic-index', '21')).toBe('')
  expect(retainLegacyEventSelection([], 'synthetic-index', '23')).toBe('')
})

test('Quest local selection follows actual event IDs and the visible terminal window', async ({
  expect
}) => {
  const { legacyJobEvents, retainLegacyEventSelection } = await import(
    '../../../assets/js/lib/questHistory.mjs'
  )
  const history = [
    { eventId: 25, jobName: 'synthetic-index', event: 'start' },
    ...Array.from({ length: 21 }, (_, index) => ({
      eventId: 24 - index,
      jobName: 'synthetic-index',
      event: 'completed'
    }))
  ]
  expect(legacyJobEvents(history, 'synthetic-index').length).toBe(20)
  expect(retainLegacyEventSelection(history, 'synthetic-index', '24')).toBe(
    '24'
  )
  expect(retainLegacyEventSelection(history, 'synthetic-index', '25')).toBe('')
  expect(retainLegacyEventSelection(history, 'synthetic-index', '4')).toBe('')
  // An identical timestamp or payload is not sufficient identity evidence.
  expect(
    retainLegacyEventSelection(
      [{ jobName: 'synthetic-index', event: 'completed' }],
      'synthetic-index',
      '24'
    )
  ).toBe('')
})
