const { test } = require('sounding')

test('health check reports the running Slipway version', async ({
  get,
  sails,
  expect
}) => {
  const response = await get('/health')

  expect(response).toHaveStatus(200)
  expect(response).toHaveJsonPath('status', 'ok')
  expect(response).toHaveJsonPath('version', sails.config.slipway.version)
})
