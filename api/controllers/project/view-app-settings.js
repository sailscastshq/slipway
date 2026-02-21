module.exports = {
  friendlyName: 'View app settings',

  description: 'Display settings page for an individual app.',

  inputs: {
    slug: {
      type: 'string',
      required: true,
      description: 'Project slug'
    },
    envSlug: {
      type: 'string',
      required: true,
      description: 'Environment slug'
    },
    appSlug: {
      type: 'string',
      required: true,
      description: 'App slug'
    }
  },

  exits: {
    success: {
      responseType: 'inertia'
    },
    notFound: {
      responseType: 'redirect'
    }
  },

  fn: async function ({ slug, envSlug, appSlug }) {
    const user = await User.findOne({ id: this.req.session.userId }).populate('team')

    const project = await Project.findOne({ slug, team: user.team.id })
    if (!project) throw { notFound: '/' }

    const environment = await Environment.findOne({ slug: envSlug, project: project.id })
    if (!environment) throw { notFound: `/projects/${slug}` }

    const app = await App.findOne({ environment: environment.id, slug: appSlug })
    if (!app) throw { notFound: `/projects/${slug}/environments/${envSlug}` }

    // Check if GitHub is connected for this team
    const gitProvider = await GitProvider.findOne({
      team: user.team.id,
      type: 'github',
      isActive: true
    })
    const githubConnected = !!gitProvider

    // Get connected repository for this app
    const gitRepo = await GitRepository.findOne({ app: app.id })
    // Determine the deploy branch from branchMappings (first key), fallback to defaultBranch
    const deployBranch = gitRepo
      ? (Object.keys(gitRepo.branchMappings || {})[0] || gitRepo.defaultBranch)
      : null

    const connectedRepo = gitRepo ? {
      id: gitRepo.id,
      fullName: gitRepo.fullName,
      htmlUrl: gitRepo.htmlUrl,
      defaultBranch: gitRepo.defaultBranch,
      deployBranch,
      autoDeploy: gitRepo.autoDeploy
    } : null

    return {
      page: 'projects/app-settings',
      props: {
        project,
        environment,
        app,
        connectedRepo,
        githubConnected
      }
    }
  }
}
