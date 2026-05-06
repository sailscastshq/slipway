const { defineScenario } = require('sounding')

const { withCsrfFromPage } = require('../world-helpers/csrf-request')

module.exports = defineScenario('csrf-guest', async ({ sails }) => {
  return {
    guest: {
      requestFor: async (path) => {
        const current = await withCsrfFromPage(sails.sounding.request, path)
        return current.request
      }
    }
  }
})
