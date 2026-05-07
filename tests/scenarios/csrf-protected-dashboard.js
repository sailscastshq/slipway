const { defineScenario } = require('sounding')

const { withCsrfFromPage } = require('../world-helpers/csrf-request')

module.exports = defineScenario(
  'csrf-protected-dashboard',
  async ({ sails }) => {
    const current = await sails.sounding.world.use('configured-slipway')
    const protectedSession = await withCsrfFromPage(
      sails.sounding.request,
      '/projects/new',
      {
        userId: current.users.genesisUser.id,
        teamId: current.teams.genesisTeam.id
      }
    )

    return {
      ...current,
      csrf: {
        token: protectedSession.token
      },
      dashboard: protectedSession.request
    }
  }
)
