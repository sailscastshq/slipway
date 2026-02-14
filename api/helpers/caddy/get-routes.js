module.exports = {
  friendlyName: 'Get routes',

  description: 'Get all Slipway routes from Caddy.',

  inputs: {},

  exits: {
    success: {
      description: 'Routes retrieved',
      outputType: 'ref'
    },
    caddyError: {
      description: 'Failed to get Caddy config'
    }
  },

  fn: async function () {
    try {
      const stdout = await sails.helpers.caddy.caddyRequest.with({
        method: 'GET',
        path: '/config/apps/http/servers/srv0/routes'
      })

      const routes = JSON.parse(stdout)
      return (routes || []).filter(
        (route) => route['@id'] && route['@id'].startsWith('slipway-')
      )
    } catch (err) {
      // No routes configured yet or Caddy not reachable
      if (err.message && err.message.includes('exit code 8')) {
        return []
      }
      sails.log.error(`Caddy get routes failed: ${err.message}`)
      return []
    }
  }
}
