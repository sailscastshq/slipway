const assert = require('node:assert/strict')
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
  assert.ok(founder)
  assert.equal(founder.isGenesisUser, true)
  assert.equal(founder.teamRole, 'owner')

  const team = await sails.models.team.findOne({ owner: founder.id })
  assert.ok(team)
  assert.equal(team.name, "Founder's Team")
  assert.equal(founder.team, team.id)
})

test('setup path is blocked once the genesis owner exists', async ({ get, expect, sails }) => {
  await sails.sounding.world.use('configured-slipway')

  const response = await get('/setup')

  expect(response).toHaveStatus(403)
})
