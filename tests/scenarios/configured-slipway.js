const { defineScenario } = require('sounding')

async function createOwner(sails, key) {
  const fullName = `Builder ${key}`
  const email = `e2e+${key}@example.com`
  const password = 'secret123'

  const user = await sails.models.user.create({
    fullName,
    email,
    password,
    emailStatus: 'verified',
    teamRole: 'owner',
    isGenesisUser: true,
  }).fetch()

  const team = await sails.models.team.create({
    name: `${fullName}'s Team`,
    owner: user.id,
  }).fetch()

  await sails.models.user.updateOne({ id: user.id }).set({
    team: team.id,
  })

  sails.config.custom.slipwayIsSetup = true

  return {
    password,
    team,
    user: await sails.models.user.findOne({ id: user.id }),
  }
}

module.exports = defineScenario('configured-slipway', async ({ sails, sequence }) => {
  const key = sequence('configured-slipway', (n) => `configured-slipway-${n}`)
  const owner = await createOwner(sails, key)

  return {
    key,
    auth: {
      genesisUserPassword: owner.password,
    },
    teams: {
      genesisTeam: owner.team,
    },
    users: {
      genesisUser: owner.user,
    },
  }
})
