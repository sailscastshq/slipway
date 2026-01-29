module.exports = {
  friendlyName: 'View settings',

  description: 'Display the settings index page.',

  inputs: {},

  exits: {
    success: {
      responseType: 'inertia'
    }
  },

  fn: async function () {
    return {
      page: 'settings/index'
    }
  }
}
