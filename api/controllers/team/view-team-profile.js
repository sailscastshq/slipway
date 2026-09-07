module.exports = {
  friendlyName: 'View team profile',

  description: 'Display the team profile editing page.',

  exits: {
    success: {
      responseType: 'inertia'
    }
  },

  fn: async function () {
    const user = await User.forRequest(this.req, { populateTeam: true })
    const team = await Team.findOne({ id: user.team.id })

    let uploadsConfigured = true
    try {
      await sails.helpers.uploads.getStorageConfig.with({
        requirePublicUrl: true
      })
    } catch {
      uploadsConfigured = false
    }

    return {
      page: 'settings/team-profile',
      props: {
        team: {
          id: team.id,
          name: team.name,
          slug: team.slug,
          logoUrl: team.logoUrl
        },
        uploadsConfigured
      }
    }
  }
}
