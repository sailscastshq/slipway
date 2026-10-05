const assert = require('node:assert/strict')
const { test } = require('sounding')
const load = () => import('../../../assets/js/lib/questSchedule.mjs')
const restart = (timing, oneShot = false) => ({
  registration: 'registered',
  validation: 'valid',
  validationErrors: [],
  restart: {
    persistence: 'memory_only',
    timing,
    oneShot,
    missedRuns: 'not_replayed'
  }
})

test('Quest job row labels add duration units without interpreting legacy source text', async () => {
  const { questScheduleLabel: label } = await load()
  for (const [scheduleType, schedule, expected] of [
    ['interval', 2000, 'Every 2 seconds'],
    ['interval', 60000, 'Every 1 minute'],
    ['interval', 7200000, 'Every 2 hours'],
    ['interval', 86400000, 'Every 1 day'],
    ['interval', 1500, 'Every 1500 milliseconds'],
    ['timeout', 500, 'Once after 500 milliseconds'],
    ['timeout', 1000, 'Once after 1 second'],
    ['timeout', 0, 'Once, immediately'],
    ['interval', 'every 2 hours', 'every 2 hours'],
    ['interval', '2000', '2000'],
    ['cron', '0 9 * * 1-5', '0 9 * * 1-5'],
    ['timeout', 'at 10:00 am', 'at 10:00 am'],
    ['date', '2026-10-04T12:00:00Z', '2026-10-04T12:00:00Z'],
    [undefined, 'every 5 minutes', 'every 5 minutes'],
    [undefined, null, 'Manual'],
    ['manual', null, 'Manual'],
    ['unavailable', 2000, 'Unavailable'],
    ['interval', null, 'Unavailable'],
    ['timeout', undefined, 'Unavailable']
  ]) {
    assert.equal(label({ scheduleType, schedule }), expected)
  }
})

test('Quest job row labels preserve invalid and unavailable schedule evidence', async () => {
  const { questScheduleLabel: label } = await load()
  for (const scheduleType of ['interval', 'timeout']) {
    for (const schedule of [-1, NaN, Infinity]) {
      assert.equal(label({ scheduleType, schedule }), 'Unavailable')
    }
    for (const schedule of [0, 2000, 'every 2 seconds']) {
      assert.equal(
        label({
          scheduleType,
          schedule,
          scheduleState: { validation: 'invalid' }
        }),
        'Invalid source schedule'
      )
    }
  }
  assert.equal(
    label({
      scheduleType: 'interval',
      schedule: 2000,
      scheduleState: { registration: 'stopped', validation: 'valid' }
    }),
    'Every 2 seconds'
  )
})

test('Quest schedule descriptions interpret common source expressions without calculating a due time', async () => {
  const { questScheduleDetails: describe } = await load()
  for (const [source, summary] of [
    ['* * * * *', 'Every minute'],
    ['*/15 * * * *', 'Every 15 minutes'],
    ['5 * * * *', 'Hourly at minute 5'],
    ['0 2 * * *', 'Daily at 02:00'],
    ['0 9 * * 1', 'Monday at 09:00'],
    ['0 9 * * 1-5', 'Monday–Friday at 09:00'],
    ['0 9 * * 7', 'Sunday at 09:00'],
    ['*/7 * * * *', 'Recurring cron expression'],
    ['0 0 1 * *', 'Recurring cron expression'],
    ['0 0 9 * * *', 'Recurring cron expression']
  ]) {
    const value = describe({
      scheduleType: 'cron',
      schedule: source,
      scheduleState: restart('wall_clock')
    })
    assert.equal(value.summary, summary)
    assert.match(value.note, /runtime determines timezone changes/)
    assert.equal(value.nextRunAt, undefined)
  }
  assert.equal(
    describe({ scheduleType: 'interval', schedule: 60000 }).summary,
    'Every 1 minute'
  )
  assert.equal(
    describe({ scheduleType: 'interval', schedule: 'every 2 hours' }).summary,
    'every 2 hours'
  )
  assert.equal(
    describe({ scheduleType: 'interval', schedule: 'at 10:00 am' }).summary,
    'Recurring: at 10:00 am'
  )
})

test('Quest restart explanations require explicit runtime semantics and distinguish scheduling timeout from execution deadline', async () => {
  const { questScheduleDetails: describe } = await load()
  assert.equal(
    describe({ scheduleType: 'interval', schedule: 1000 }).note,
    'Restart behavior unavailable from this runtime.'
  )
  assert.match(
    describe({
      scheduleType: 'interval',
      schedule: 1000,
      scheduleState: restart('relative_to_registration')
    }).note,
    /interval starts again.*Missed runs are not replayed/
  )
  const immediate = describe({
    scheduleType: 'timeout',
    schedule: 0,
    scheduleState: restart('relative_to_registration', true)
  })
  assert.equal(immediate.summary, 'Once after 0 milliseconds')
  assert.match(immediate.note, /Runs once.*not an execution deadline/)
  const at = describe({
    scheduleType: 'timeout',
    schedule: 'at 10:00 am',
    scheduleState: restart('wall_clock', true)
  })
  assert.equal(at.summary, 'Once at 10:00 am')
  assert.match(
    at.note,
    /Past occurrences are not replayed.*not an execution deadline/
  )
  const date = describe({
    scheduleType: 'date',
    schedule: '2020-01-01T00:00:00Z',
    scheduleState: {
      ...restart('wall_clock', true),
      registration: 'not_registered',
      reason: 'no_future_run'
    }
  })
  assert.equal(date.summary, 'Once at the source date')
  assert.match(date.note, /Past occurrences are not replayed/)
  assert.deepEqual(describe({ scheduleType: 'manual' }), {
    summary: 'Run on demand',
    note: null
  })
})

test('Quest schedule descriptions preserve invalid, stopped and unavailable distinctions', async () => {
  const { questScheduleDetails: describe } = await load()
  const source = {
    scheduleType: 'interval',
    schedule: 60000,
    scheduleState: restart('relative_to_registration')
  }
  assert.equal(
    describe({
      ...source,
      scheduleState: { ...source.scheduleState, registration: 'stopped' }
    }).summary,
    'Every 1 minute'
  )
  assert.equal(
    describe({
      ...source,
      scheduleState: { ...source.scheduleState, validation: 'invalid' }
    }).summary,
    'Invalid source schedule'
  )
  assert.equal(describe({ scheduleType: 'unavailable' }).summary, 'Unavailable')
  assert.equal(
    describe({
      ...source,
      scheduleState: {
        ...source.scheduleState,
        restart: { ...source.scheduleState.restart, missedRuns: 'catch_up' }
      }
    }).note,
    'Restart behavior unavailable from this runtime.'
  )
})

test('Quest zero scheduling delay is a one-shot source schedule rather than a manual placeholder', async () => {
  const { hasQuestSchedule, questJobState } = await import(
    '../../../assets/js/lib/questWorkspace.mjs'
  )
  const job = {
    scheduleType: 'timeout',
    schedule: 0,
    paused: false,
    isRunning: false,
    scheduled: false
  }
  assert.equal(hasQuestSchedule(job), true)
  assert.equal(questJobState(job, { mode: 'resident' }), 'inactive')
  assert.equal(
    questJobState({ ...job, scheduled: true }, { mode: 'resident' }),
    'scheduled'
  )
  assert.equal(hasQuestSchedule({ ...job, scheduleType: 'manual' }), false)
  assert.equal(hasQuestSchedule({ ...job, scheduleType: 'unavailable' }), false)
})
