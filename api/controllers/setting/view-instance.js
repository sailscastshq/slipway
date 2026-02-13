module.exports = {
  friendlyName: 'View instance settings',

  description: 'Display the instance configuration settings page.',

  exits: {
    success: {
      responseType: 'inertia'
    }
  },

  fn: async function () {
    const instanceDomain = await sails.helpers.setting.get('instanceDomain', '')
    const instanceName = await sails.helpers.setting.get('instanceName', 'Slipway')
    const acmeEmail = await sails.helpers.setting.get('acmeEmail', '')

    return {
      page: 'settings/instance',
      props: {
        instanceDomain,
        instanceName,
        acmeEmail
      }
    }
  }
}
