const { test } = require('sounding')

test('the genesis user gets the setup path before Slipway is configured', async ({ visit, expect }) => {
  const response = await visit('/')

  expect(response).toHaveStatus(302)
  expect(response).toRedirectTo('/setup')
})

test('setup creates the genesis owner and default team', async ({ post, expect, sails }) => {
  const response = await post('/setup', {
    email: 'founder@example.com',
    password: 'secret123',
  })

  expect(response).toHaveStatus(302)
  expect(response).toRedirectTo('/')
  expect(sails.config.custom.slipwayIsSetup).toBe(true)

  const founder = await sails.models.user.findOne({ email: 'founder@example.com' })
  expect(Boolean(founder)).toBe(true)
  expect(founder.isGenesisUser).toBe(true)
  expect(founder.teamRole).toBe('owner')

  const team = await sails.models.team.findOne({ owner: founder.id })
  expect(Boolean(team)).toBe(true)
  expect(team.name).toBe("Founder's Team")
  expect(founder.team).toBe(team.id)
})

test('setup path is blocked once the genesis owner exists', async ({ get, expect, sails }) => {
  await sails.sounding.world.use('configured-slipway')

  const response = await get('/setup')

  expect(response).toHaveStatus(403)
})
