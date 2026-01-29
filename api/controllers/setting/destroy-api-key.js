module.exports = {
  friendlyName: 'Destroy CLI key',

  description: 'Revoke and delete a CLI token.',

  inputs: {
    id: {
      type: 'string',
      required: true,
      description: 'Token ID'
    }
  },

  exits: {
    success: {
      responseType: 'inertiaRedirect'
    },
    notFound: {
      responseType: 'redirect'
    }
  },

  fn: async function ({ id }) {
    const user = await User.findOne({ id: this.req.session.userId })

    const token = await CliToken.findOne({ id, user: user.id })

    if (!token) {
      throw { notFound: '/settings/api-keys' }
    }

    await CliToken.destroyOne({ id })

    return '/settings/api-keys'
  }
}
