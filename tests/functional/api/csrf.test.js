const { test } = require('sounding')

test('dashboard pages expose a csrf token to browser requests', async ({
  sails,
  expect
}) => {
  const current = await sails.sounding.world.use('csrf-protected-dashboard')

  expect(typeof current.csrf.token).toBe('string')
  expect(current.csrf.token.length > 0).toBe(true)
})

test('session dashboard mutations without csrf are rejected', async ({
  sails,
  expect
}) => {
  const current = await sails.sounding.world.use('configured-slipway')

  const response = await sails.sounding.request
    .as(current.users.genesisUser)
    .post('/projects', {
      name: 'No Token'
    })

  expect(response).toHaveStatus(403)
})

test('csrf protected dashboard sessions can mutate api routes', async ({
  sails,
  expect
}) => {
  const current = await sails.sounding.world.use('csrf-protected-dashboard')

  const response = await current.dashboard.post('/api/v1/projects', {
    name: 'API Launch Pad'
  })

  expect(response).toHaveStatus(201)
  expect(response).toHaveJsonPath('project.slug', 'api-launch-pad')
})

test('public cli auth initialization is explicitly exempt from csrf', async ({
  post,
  expect
}) => {
  const response = await post('/api/v1/cli/auth/init', {})

  expect(response).toHaveStatus(200)
  expect(response.data.code).toBeTruthy()
})
