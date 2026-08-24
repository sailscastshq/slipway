const { test } = require('sounding')

const createInFlightWork = require('../../../api/lib/in-flight-work')

test('drain waits for work that already started', async ({ expect }) => {
  const tracker = createInFlightWork()
  let finishWork
  let drained = false

  const work = tracker.run(
    () =>
      new Promise((resolve) => {
        finishWork = resolve
      }),
    null
  )
  const drain = tracker.drain().then(() => {
    drained = true
  })

  await Promise.resolve()
  expect(tracker.pending).toBe(1)
  expect(drained).toBe(false)

  finishWork('complete')

  expect(await work).toBe('complete')
  await drain
  expect(tracker.pending).toBe(0)
  expect(drained).toBe(true)
})

test('work registered after draining begins uses its shutdown fallback', async ({
  expect
}) => {
  const tracker = createInFlightWork()
  let started = false

  await tracker.drain()
  const result = await tracker.run(() => {
    started = true
    return ['late query']
  }, [])

  expect(result).toEqual([])
  expect(started).toBe(false)
  expect(tracker.draining).toBe(true)
  expect(tracker.pending).toBe(0)
})
