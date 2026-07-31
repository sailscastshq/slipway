const { test } = require('sounding')
const {
  createReleaseFlags,
  bucket
} = require('../../../packages/hook/lib/release-flags')

test('release flags honor typed targets before percentage rollout', async ({
  expect
}) => {
  const flags = createReleaseFlags({
    url: 'https://slipway.example/flags',
    token: 'stk_test',
    requestJson: async () => ({
      version: 'config-1',
      flags: [
        {
          key: 'new-checkout',
          enabled: true,
          rolloutPercentage: 0,
          targets: ['user:42'],
          version: 2
        }
      ]
    })
  })
  await flags.refresh()

  const targeted = await flags.evaluate({
    key: 'new-checkout',
    context: { user: 42 }
  })
  const untargeted = await flags.evaluate({
    key: 'new-checkout',
    context: { user: 43 }
  })

  expect(targeted.value).toBe(true)
  expect(targeted.reason).toBe('targeted')
  expect(untargeted.value).toBe(false)
})

test('percentage rollout is deterministic and fails safe without context', async ({
  expect
}) => {
  const percentage = 37
  const flags = createReleaseFlags({
    url: 'https://slipway.example/flags',
    token: 'stk_test',
    requestJson: async () => ({
      flags: [
        {
          key: 'new-checkout',
          enabled: true,
          rolloutPercentage: percentage,
          targets: []
        }
      ]
    })
  })
  await flags.refresh()
  const expected = bucket('new-checkout:user:customer-7') < percentage

  const first = await flags.evaluate({
    key: 'new-checkout',
    context: { user: 'customer-7' }
  })
  const second = await flags.evaluate({
    key: 'new-checkout',
    context: { user: 'customer-7' }
  })
  const anonymous = await flags.evaluate({ key: 'new-checkout' })

  expect(first.value).toBe(expected)
  expect(second.value).toBe(expected)
  expect(anonymous.value).toBe(false)
  expect(anonymous.reason).toBe('missing-context')
})

test('release flag config refreshes without redeploying and uses explicit defaults when unavailable', async ({
  expect
}) => {
  let enabled = false
  let available = true
  let now = 1000
  const flags = createReleaseFlags({
    url: 'https://slipway.example/flags',
    token: 'stk_test',
    refreshInterval: 1,
    now: () => now,
    requestJson: async () => {
      if (!available) throw new Error('offline')
      return {
        flags: [
          {
            key: 'new-checkout',
            enabled,
            rolloutPercentage: 100,
            targets: []
          }
        ]
      }
    }
  })

  await flags.refresh()
  expect((await flags.evaluate({ key: 'new-checkout' })).value).toBe(false)
  enabled = true
  now += 2
  await flags.refresh()
  expect((await flags.evaluate({ key: 'new-checkout' })).value).toBe(true)

  available = false
  const empty = createReleaseFlags({
    url: 'https://slipway.example/flags',
    token: 'stk_test',
    requestJson: async () => {
      throw new Error('offline')
    }
  })
  expect(
    (await empty.evaluate({ key: 'unknown', defaultValue: true })).value
  ).toBe(true)
})
