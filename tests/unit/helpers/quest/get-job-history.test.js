const { test } = require('sounding')

test('Quest legacy history normalizes scheduled and manual events without correlating starts', async ({
  sails,
  expect
}) => {
  const environment = 765001
  const now = Date.now()
  const names = ['start', 'complete', 'error', 'completed', 'failed', 'skipped']
  await sails.models.telemetrymetric.createEach(
    names.map((event, index) => ({
      environment,
      name: `quest.job.${event}`,
      value: index,
      recordedAt: now - index,
      attributes: {
        jobName: 'synthetic-index',
        ...(index >= 3 ? { trigger: 'manual' } : {}),
        stdout: 'synthetic output',
        stderr: 'synthetic warning',
        error: event === 'error' || event === 'failed' ? 'synthetic error' : ''
      }
    }))
  )

  const history = await sails.helpers.quest.getJobHistory(environment)
  expect(history.map((event) => event.event)).toEqual([
    'start',
    'completed',
    'failed',
    'completed',
    'failed',
    'skipped'
  ])
  expect(
    history.filter((event) => ['completed', 'failed'].includes(event.event))
      .length
  ).toBe(4)
  expect(history[1]).toEqual({
    event: 'completed',
    legacy: true,
    eventId: history[1].eventId,
    jobName: 'synthetic-index',
    duration: 1,
    error: null,
    stdout: 'synthetic output',
    stderr: 'synthetic warning',
    trigger: 'scheduled',
    recordedAt: now - 1
  })
  expect(Number.isInteger(history[1].eventId)).toBe(true)
  expect(new Set(history.map((event) => event.eventId)).size).toBe(
    history.length
  )
  expect(history[2].error).toBe('synthetic error')
  expect(history[3].trigger).toBe('manual')
  expect(
    history.every((event) => !('runId' in event) && !('exitCode' in event))
  ).toBe(true)
})

test('Quest legacy history keeps the environment, seven-day window, and 500-event bound', async ({
  sails,
  expect
}) => {
  const environment = 765002
  const now = Date.now()
  const metric = (overrides = {}) => ({
    environment,
    name: 'quest.job.start',
    value: 0,
    attributes: { jobName: 'synthetic-index' },
    recordedAt: now,
    ...overrides
  })
  await sails.models.telemetrymetric.createEach([
    ...Array.from({ length: 501 }, (_, index) =>
      metric({ recordedAt: now - index })
    ),
    metric({ environment: 765003, name: 'quest.job.error' }),
    metric({ name: 'quest.job.complete', recordedAt: now - 8 * 86400000 }),
    metric({ name: 'unrelated.metric' })
  ])
  const history = await sails.helpers.quest.getJobHistory(environment)
  expect(history.length).toBe(500)
  expect(history.every((event) => event.event === 'start')).toBe(true)
  expect(history[0].recordedAt).toBe(now)
  expect(history.at(-1).recordedAt).toBe(now - 499)
})
