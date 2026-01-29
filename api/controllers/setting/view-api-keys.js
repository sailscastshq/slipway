module.exports = {
  friendlyName: 'View CLI keys',

  description: 'Display CLI keys management page.',

  inputs: {},

  exits: {
    success: {
      responseType: 'inertia'
    }
  },

  fn: async function () {
    const user = await User.findOne({ id: this.req.session.userId })

    const tokens = await CliToken.find({ user: user.id })
      .sort('createdAt DESC')

    return {
      page: 'settings/api-keys',
      props: {
        tokens: tokens.map(t => ({
          id: t.id,
          name: t.name,
          lastUsedAt: t.lastUsedAt,
          createdAt: t.createdAt
        }))
      }
    }
  }
}
