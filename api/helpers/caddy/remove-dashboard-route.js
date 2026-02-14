module.exports = {
  friendlyName: 'Remove dashboard route',

  description: 'Remove the Caddy route for the Slipway dashboard domain.',

  inputs: {},

  exits: {
    success: {
      description: 'Dashboard route removed successfully'
    }
  },

  fn: async function () {
    const routeId = 'slipway-dashboard'

    try {
      await sails.helpers.caddy.caddyRequest.with({
        method: 'DELETE',
        path: `/id/${routeId}`
      })
      sails.log.info('Caddy dashboard route removed')
    } catch (err) {
      sails.log.verbose(`Caddy dashboard route removal skipped: ${err.message}`)
    }
  }
}
