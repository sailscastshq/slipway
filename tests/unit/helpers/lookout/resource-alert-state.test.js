const { test } = require('sounding')
const {
  advanceResourceAlertState
} = require('../../../../api/lib/resource-alert-state')

test('a sustained high-memory incident alerts once across persisted cycles', async ({
  sails,
  expect
}) => {
  const containerName = 'resource-alert-test-container'
  const model = sails.models.resourcealertstate
  const sample = { cpuPercent: 0.02, memPercent: 91.36 }
  const alerts = []

  await model.destroy({ containerName })
  try {
    for (let index = 0; index < 8; index++) {
      // Every cycle reads the durable row as a fresh hook process would.
      const previous = await model.findOne({ containerName })
      const result = advanceResourceAlertState(
        previous,
        sample,
        index * 30000 + 1
      )
      if (previous) {
        await model.updateOne({ id: previous.id }).set(result.state)
      } else {
        await model.create({ containerName, ...result.state })
      }
      if (result.memHigh) alerts.push(index)
    }

    expect(alerts).toEqual([2])
    expect((await model.findOne({ containerName })).memoryActive).toBe(true)
  } finally {
    await model.destroy({ containerName })
  }
})

test('three recovery samples re-arm an alert; threshold flapping does not', async ({
  expect
}) => {
  let stored
  let now = 1
  const sample = (memoryPercent) => {
    const result = advanceResourceAlertState(
      stored,
      { cpuPercent: 1, memPercent: memoryPercent },
      now
    )
    stored = result.state
    now += 30000
    return result.memHigh
  }

  expect([sample(91), sample(92), sample(93)]).toEqual([false, false, true])
  expect([sample(88), sample(84), sample(91), sample(84)]).toEqual([
    false,
    false,
    false,
    false
  ])
  expect(stored.memoryActive).toBe(true)
  sample(82)
  sample(83)
  expect(stored.memoryActive).toBe(false)
  expect([sample(91), sample(92), sample(93)]).toEqual([false, false, true])
})

test('sampling gaps break a pending high streak but not an active incident', async ({
  expect
}) => {
  const stat = { cpuPercent: 95, memPercent: 10 }
  const first = advanceResourceAlertState(null, stat, 1)
  const afterGap = advanceResourceAlertState(first.state, stat, 180001)
  expect(afterGap.cpuHigh).toBe(false)
  expect(afterGap.state.cpuHighSamples).toBe(1)

  const second = advanceResourceAlertState(afterGap.state, stat, 210001)
  const third = advanceResourceAlertState(second.state, stat, 240001)
  expect(third.cpuHigh).toBe(true)
  const activeAfterGap = advanceResourceAlertState(third.state, stat, 600001)
  expect(activeAfterGap.cpuHigh).toBe(false)
  expect(activeAfterGap.state.cpuActive).toBe(true)
})
