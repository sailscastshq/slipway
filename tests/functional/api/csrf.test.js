const { test } = require('sounding')
const { withCsrfFromPage } = require('../../support/csrf-request')

test(
  'dashboard pages expose a csrf token to browser requests',
  { world: 'configured-slipway' },
  async ({ request, expect }) => {
    const dashboard = await withCsrfFromPage(
      request,
      '/projects/new',
      'genesisUser'
    )

    expect(typeof dashboard.token).toBe('string')
    expect(dashboard.token.length > 0).toBe(true)
  }
)

test(
  'session dashboard mutations without csrf are rejected',
  { world: 'configured-slipway' },
  async ({ request, expect }) => {
    const response = await request.as('genesisUser').post('/projects', {
      name: 'No Token'
    })

    expect(response).toHaveStatus(403)
  }
)

test(
  'csrf protected dashboard sessions can mutate api routes',
  { world: 'configured-slipway' },
  async ({ request, expect }) => {
    const dashboard = await withCsrfFromPage(
      request,
      '/projects/new',
      'genesisUser'
    )

    const response = await dashboard.request.post('/api/v1/projects', {
      name: 'API Launch Pad'
    })

    expect(response).toHaveStatus(201)
    expect(response).toHaveJsonPath('project.slug', 'api-launch-pad')
  }
)

test('public cli auth initialization is explicitly exempt from csrf', async ({
  post,
  expect
}) => {
  const response = await post('/api/v1/cli/auth/init', {})

  expect(response).toHaveStatus(200)
  expect(response.data.code).toBeTruthy()
})
