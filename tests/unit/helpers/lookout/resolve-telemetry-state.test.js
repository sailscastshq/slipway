const { test } = require('sounding')

test('Lookout resolves hook installation and runtime connectivity independently', async ({
  sails,
  expect
}) => {
  const now = 2_000_000
  const staleAfterMs = 180_000
  const detectedFeature = { version: '^0.0.9' }
  const connection = {
    hookVersion: '0.0.9',
    protocolVersion: 1,
    deployment: '42',
    enabled: true,
    startedAt: now - 60_000,
    lastSeenAt: now - 1_000,
    capabilities: { requests: true }
  }
  const resolve = (overrides = {}) =>
    sails.helpers.lookout.resolveTelemetryState.with({
      detectedFeature,
      connection,
      currentDeploymentId: '42',
      hasRecentData: false,
      now,
      staleAfterMs,
      ...overrides
    })

  expect(resolve({ detectedFeature: null }).state).toBe('not_detected')
  expect(
    resolve({
      detectedFeature: { version: '^0.0.8' },
      connection: null
    }).state
  ).toBe('incompatible')
  expect(resolve({ connection: null }).state).toBe('redeploy_required')
  expect(resolve({ connection: { ...connection, enabled: false } }).state).toBe(
    'disabled'
  )
  expect(resolve({ currentDeploymentId: '43' }).state).toBe('redeploy_required')
  expect(
    resolve({
      connection: {
        ...connection,
        lastSeenAt: now - staleAfterMs - 1
      }
    }).state
  ).toBe('stale')
  expect(resolve().state).toBe('connected_quiet')
  expect(resolve({ hasRecentData: true }).state).toBe('receiving')
})
