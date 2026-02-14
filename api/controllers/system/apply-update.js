module.exports = {
  friendlyName: 'Apply update',

  description: 'Trigger a Slipway self-update to the latest version.',

  inputs: {},

  exits: {
    success: {
      description: 'Update initiated successfully.'
    },
    badRequest: {
      responseType: 'badRequest',
      description: 'Already running the latest version.'
    },
    serverError: {
      responseType: 'serverError',
      description: 'Failed to apply update.'
    }
  },

  fn: async function () {
    const result = await sails.helpers.system.applyUpdate()
    return result
  }
}
