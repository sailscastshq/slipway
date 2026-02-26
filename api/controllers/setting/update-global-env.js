module.exports = {
  friendlyName: 'Update global environment',

  description: 'Update global environment variables.',

  inputs: {
    envVars: {
      type: 'json',
      required: true,
      description: 'Global environment variables as key-value object'
    }
  },

  exits: {
    success: {
      responseType: 'inertiaRedirect'
    },
    forbidden: {
      statusCode: 403
    }
  },

  fn: async function ({ envVars }) {
    const user = await User.findOne({ id: this.req.session.userId })

    // Only owners and admins can modify global env vars
    if (user.teamRole !== 'owner' && user.teamRole !== 'admin') {
      throw 'forbidden'
    }

    await sails.helpers.setting.set(
      'globalEnvVars',
      JSON.stringify(envVars),
      'Instance-wide environment variables injected into all deployed applications'
    )

    return '/settings/global-env'
  }
}
