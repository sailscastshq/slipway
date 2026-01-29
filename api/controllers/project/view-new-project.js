module.exports = {
  friendlyName: 'View new project',

  description: 'Display the create project page.',

  exits: {
    success: {
      responseType: 'inertia'
    }
  },

  fn: async function () {
    return {
      page: 'projects/new'
    }
  }
}
