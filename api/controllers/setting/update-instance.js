module.exports = {
  friendlyName: 'Update instance settings',

  description: 'Update the instance configuration.',

  inputs: {
    instanceDomain: {
      type: 'string',
      description: 'The domain/URL of this Slipway instance'
    },
    instanceName: {
      type: 'string',
      description: 'The name of this Slipway instance'
    }
  },

  exits: {
    success: {
      responseType: 'inertiaRedirect'
    }
  },

  fn: async function ({ instanceDomain, instanceName }) {
    if (instanceDomain !== undefined) {
      // Clean up the domain - remove protocol and trailing slashes
      let cleanDomain = instanceDomain.trim()
        .replace(/^https?:\/\//, '')
        .replace(/\/+$/, '')
      await sails.helpers.setting.set('instanceDomain', cleanDomain)
    }

    if (instanceName !== undefined) {
      await sails.helpers.setting.set('instanceName', instanceName.trim())
    }

    this.req._sails.inertia.flash('success', 'Instance settings updated')
    return '/settings/instance'
  }
}
