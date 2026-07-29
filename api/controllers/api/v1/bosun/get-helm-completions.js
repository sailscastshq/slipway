module.exports = {
  friendlyName: 'Get Bosun Helm completions',

  description:
    'Return secret-free Sails completion metadata for the Slipway instance.',

  exits: {
    success: {
      statusCode: 200
    }
  },

  fn: async function () {
    this.res.set('Cache-Control', 'private, no-store')

    try {
      return await sails.helpers.helm.getCompletions()
    } catch {
      return {
        available: false,
        version: 1,
        truncated: false,
        models: [],
        helpers: [],
        config: []
      }
    }
  }
}
