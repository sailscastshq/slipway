module.exports = {
  friendlyName: 'View setup',

  description: 'Display the initial Slipway setup page.',

  exits: {
    success: {
      responseType: 'inertia'
    }
  },

  fn: async function () {
    return { page: 'setup/setup' }
  }
}
