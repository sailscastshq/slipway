const { test } = require('sounding')

test('app health paths normalize to an absolute readiness route', async ({
  expect
}) => {
  expect(App.normalizeHealthPath()).toBe('/health')
  expect(App.normalizeHealthPath('')).toBe('/health')
  expect(App.normalizeHealthPath('   ')).toBe('/health')
  expect(App.normalizeHealthPath('ready')).toBe('/ready')
  expect(App.normalizeHealthPath('/api/health')).toBe('/api/health')
})
