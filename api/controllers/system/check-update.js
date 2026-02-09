module.exports = {
  friendlyName: 'Check update',

  description: 'API endpoint to check if a Slipway update is available.',

  inputs: {},

  exits: {
    success: {
      description: 'Update status retrieved successfully.'
    }
  },

  fn: async function () {
    const updateInfo = await sails.helpers.system.checkForUpdates()
    return updateInfo
  }
}
