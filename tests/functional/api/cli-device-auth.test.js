const { test } = require('sounding')
const { withCsrfFromPage } = require('../../support/csrf-request')

test(
  'only the private device secret retrieves a persisted CLI credential once',
  { world: 'configured-slipway' },
  async ({ request, sails, world, expect }) => {
    const init = await request.post('/api/v1/cli/auth/init', {
      protocolVersion: 2
    })
    expect(init).toHaveStatus(200)
    const { code, deviceCode, loginUrl } = init.data
    expect(deviceCode.length).toBe(64)
    expect(loginUrl.includes(deviceCode)).toBe(false)
    const browser = await withCsrfFromPage(request, '/settings', 'genesisUser')
    const confirmed = await browser.request.post('/api/v1/cli/auth/confirm', {
      code
    })
    expect(confirmed).toHaveStatus(200)
    expect(
      await sails.models.clitoken.count({
        user: world.current.users.genesisUser.id
      })
    ).toBe(1)
    expect(
      await request.post('/api/v1/cli/auth/check', { deviceCode: code })
    ).toHaveStatus(404)
    const result = await request.post('/api/v1/cli/auth/check', { deviceCode })
    expect(result).toHaveStatus(200)
    expect(result.data.status).toBe('authenticated')
    expect(
      await request
        .withHeaders({ authorization: `Bearer ${result.data.token}` })
        .get('/api/v1/projects')
    ).toHaveStatus(200)
    expect(
      await request.post('/api/v1/cli/auth/check', { deviceCode })
    ).toHaveStatus(404)
    expect(
      await browser.request.post('/api/v1/cli/auth/confirm', { code })
    ).toHaveStatus(404)
  }
)

test('old CLI versions get an explicit upgrade response', async ({
  post,
  expect
}) => {
  const result = await post('/api/v1/cli/auth/init', {})
  expect(result).toHaveStatus(426)
  expect(result.data.message).toContain('Update the Slipway CLI')
})
