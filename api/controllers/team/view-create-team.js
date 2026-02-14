module.exports = {
  friendlyName: 'View create team',

  description: 'Display the create new team page.',

  exits: {
    success: {
      responseType: 'inertia'
    }
  },

  fn: async function () {
    return {
      page: 'teams/create'
    }
  }
}
