const { test } = require('sounding')

test('update checks stay local when notifications are disabled', async ({
  sails,
  expect
}) => {
  const originalFetch = global.fetch
  let fetchCalled = false

  global.fetch = async () => {
    fetchCalled = true
    throw new Error('Network should not be used')
  }

  try {
    const result = await sails.helpers.system.checkForUpdates()

    expect(fetchCalled).toBe(false)
    expect(result.currentVersion).toBe(sails.config.slipway.version)
    expect(result.latestVersion).toBe(sails.config.slipway.version)
    expect(result.updateAvailable).toBe(false)
    expect(result.error).toBe(null)
  } finally {
    global.fetch = originalFetch
  }
})
