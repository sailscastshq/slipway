module.exports = {
  friendlyName: 'Update CLI key',

  description: 'Rename a CLI token.',

  inputs: {
    id: {
      type: 'string',
      required: true,
      description: 'Token ID'
    },
    name: {
      type: 'string',
      required: true,
      description: 'New name for the token'
    }
  },

  exits: {
    success: {
      responseType: 'inertiaRedirect'
    },
    notFound: {
      responseType: 'redirect'
    },
    invalid: {
      responseType: 'badRequest'
    },
    precognitionSuccess: {
      responseType: 'precognitionSuccess'
    }
  },

  fn: async function ({ id, name }) {
    const user = await User.findOne({ id: this.req.session.userId })

    const token = await CliToken.findOne({ id, user: user.id })

    if (!token) {
      throw { notFound: '/settings/api-keys' }
    }

    const problems = sails.helpers.setting.validate(
      { name },
      ['name'],
      this.req
    )
    if (problems.length) {
      throw { invalid: { problems } }
    }
    if (sails.inertia.isPrecognitive(this.req)) {
      throw 'precognitionSuccess'
    }

    await CliToken.updateOne(id).set({ name: name.trim() })

    sails.inertia.flash('success', 'Token renamed.')
    return '/settings/api-keys'
  }
}
