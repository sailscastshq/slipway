module.exports = {
  friendlyName: 'View team profile',

  description: 'Display the team profile editing page.',

  exits: {
    success: {
      responseType: 'inertia'
    }
  },

  fn: async function () {
    const user = await User.findOne({ id: this.req.session.userId }).populate('team')
    const team = await Team.findOne({ id: user.team.id })

    // Check if uploads are configured (for logo upload)
    let globalEnvVars = {}
    try {
      const globalJson = await sails.helpers.setting.get('globalEnvVars', '{}')
      globalEnvVars = JSON.parse(globalJson)
    } catch { /* ignore */ }

    const uploadsConfigured = !!(
      (globalEnvVars.R2_ACCESS_KEY && globalEnvVars.R2_SECRET_KEY && globalEnvVars.R2_BUCKET) ||
      (globalEnvVars.S3_ACCESS_KEY && globalEnvVars.S3_SECRET_KEY && globalEnvVars.S3_BUCKET) ||
      (globalEnvVars.SPACES_ACCESS_KEY && globalEnvVars.SPACES_SECRET_KEY && globalEnvVars.SPACES_BUCKET) ||
      (sails.config.uploads?.key && sails.config.uploads?.secret && sails.config.uploads?.bucket)
    )

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
