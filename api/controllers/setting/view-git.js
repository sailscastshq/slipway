module.exports = {
  friendlyName: 'View Git Settings',

  description: 'Display the Git integration settings page.',

  inputs: {},

  exits: {
    success: {
      responseType: 'inertia'
    },
    notFound: {
      responseType: 'redirect'
    }
  },

  fn: async function () {
    const user = await User.findOne({ id: this.req.session.userId }).populate('team')

    if (!user) {
      throw { notFound: '/login' }
    }

    // Check if GitHub OAuth is configured (via settings, config, or env)
    const githubClientId = await sails.helpers.setting.get('githubClientId') ||
      sails.config.custom.github?.clientId ||
      process.env.GITHUB_CLIENT_ID
    const githubClientSecret = await sails.helpers.setting.get('githubClientSecret') ||
      sails.config.custom.github?.clientSecret ||
      process.env.GITHUB_CLIENT_SECRET
    const githubConfigured = !!(githubClientId && githubClientSecret)

    // Get GitHub provider for this team
    const githubProvider = await GitProvider.findOne({
      team: user.team.id,
      type: 'github',
      isActive: true
    })

    // Get connected repositories
    let connectedRepos = []
    if (githubProvider) {
      connectedRepos = await GitRepository.find({
        provider: githubProvider.id
      }).populate('environment')
    }

    // Get deploy tokens
    const deployTokens = await DeployToken.find({
      team: user.team.id,
      isActive: true
    })
      .populate('project')
      .populate('environment')
      .sort('createdAt DESC')

    // Get projects for token scoping
    const projects = await Project.find({ team: user.team.id })
      .sort('name ASC')

    return {
      page: 'settings/git',
      props: {
        githubConfigured,
        githubConnected: !!githubProvider,
        githubUser: githubProvider ? githubProvider.name.replace('GitHub (', '').replace(')', '') : null,
        connectedRepos: connectedRepos.map(r => ({
          id: r.id,
          fullName: r.fullName,
          defaultBranch: r.defaultBranch,
          isPrivate: r.isPrivate,
          environment: r.environment ? {
            id: r.environment.id,
            slug: r.environment.slug
          } : null,
          autoDeploy: r.autoDeploy,
          webhookActive: !!r.webhookId
        })),
        deployTokens: deployTokens.map(t => ({
          id: t.id,
          name: t.name,
          tokenPrefix: t.tokenPrefix,
          scopes: t.scopes,
          project: t.project ? { id: t.project.id, name: t.project.name } : null,
          environment: t.environment ? { id: t.environment.id, slug: t.environment.slug } : null,
          lastUsedAt: t.lastUsedAt,
          usageCount: t.usageCount,
          expiresAt: t.expiresAt,
          createdAt: t.createdAt
        })),
        projects: projects.map(p => ({
          id: p.id,
          name: p.name,
          slug: p.slug
        }))
      }
    }
  }
}
