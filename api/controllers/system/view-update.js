module.exports = {
  friendlyName: 'View update',

  description: 'Display the update status and instructions page.',

  inputs: {},

  exits: {
    success: {
      viewTemplatePath: 'pages/system/update'
    }
  },

  fn: async function () {
    const updateInfo = await sails.helpers.system.checkForUpdates()

    return {
      page: 'settings/update',
      props: {
        updateInfo
      }
    }
  }
}
