module.exports = {
  friendlyName: 'Update global environment',

  description: 'Update global environment variables.',

  inputs: {
    envVars: {
      type: 'json',
      required: true,
      description: 'Global environment variables as key-value object'
    },
    envSource: {
      type: 'string',
      description: 'Optional raw KEY=value input used to detect duplicate keys'
    }
  },

  exits: {
    success: {
      responseType: 'inertiaRedirect'
    },
    forbidden: {
      statusCode: 403
    },
    invalid: {
      responseType: 'badRequest'
    },
    precognitionSuccess: {
      responseType: 'precognitionSuccess'
    }
  },

  fn: async function ({ envVars, envSource }) {
    const user = await User.findOne({ id: this.req.session.userId })

    // Only owners and admins can modify global env vars
    if (user.teamRole !== 'owner' && user.teamRole !== 'admin') {
      throw 'forbidden'
    }

    const problems = sails.helpers.setting.validate(
      { envVars, envSource },
      [],
      this.req
    )
    if (problems.length) {
      throw { invalid: { problems } }
    }
    if (sails.inertia.isPrecognitive(this.req)) {
      throw 'precognitionSuccess'
    }

    await sails.helpers.setting.set(
      'globalEnvVars',
      JSON.stringify(envVars),
      'Instance-wide environment variables injected into all deployed applications'
    )

    return '/settings/global-env'
  }
}
