module.exports = {
  friendlyName: 'Update Git Config',

  description: 'Update GitHub OAuth configuration settings.',

  inputs: {
    clientId: {
      type: 'string',
      required: true,
      description: 'GitHub OAuth App Client ID'
    },
    clientSecret: {
      type: 'string',
      required: true,
      description: 'GitHub OAuth App Client Secret'
    }
  },

  exits: {
    success: {
      responseType: 'inertiaRedirect'
    },
    forbidden: {
      statusCode: 403,
      description: 'Only admins can configure GitHub OAuth'
    }
  },

  fn: async function ({ clientId, clientSecret }) {
    const user = await User.findOne({ id: this.req.session.userId })

    if (user.teamRole !== 'owner' && user.teamRole !== 'admin') {
      throw 'forbidden'
    }

    await sails.helpers.setting.set('githubClientId', clientId.trim())
    await sails.helpers.setting.set('githubClientSecret', clientSecret.trim())

    sails.log.info(`[git] GitHub OAuth configured by ${user.email}`)

    sails.inertia.flash('success', 'GitHub OAuth configured successfully')
    return '/settings/git'
  }
}
