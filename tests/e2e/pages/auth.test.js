const { test } = require('sounding')

test('a guest is sent to login once Slipway is configured', async ({ visit, expect, sails }) => {
  await sails.sounding.world.use('configured-slipway')

  const response = await visit('/')

  expect(response).toHaveStatus(302)
  expect(response).toRedirectTo('/login')
})

test('genesis user can authenticate with the real password flow', async ({ auth, expect, sails }) => {
  const current = await sails.sounding.world.use('configured-slipway')

  const result = await auth.request.withPassword(current.users.genesisUser, {
    password: current.auth.genesisUserPassword,
    returnUrl: '/projects/new',
  })

  expect(result.response).toHaveStatus(302)
  expect(result.response).toRedirectTo('/projects/new')
})
