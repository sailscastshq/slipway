module.exports = {
  friendlyName: 'View environment settings',

  description: 'Display environment settings page.',

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

  fn: async function ({ slug, envSlug }) {
    const user = await User.findOne({ id: this.req.session.userId }).populate('team')

    const project = await Project.findOne({ slug, team: user.team.id })

    if (!project) {
      throw { notFound: '/' }
    }

    const environment = await Environment.findOne({
      project: project.id,
      slug: envSlug
    })

    if (!environment) {
      throw { notFound: `/projects/${slug}` }
    }

    // Check if environment has app or services
    const app = await App.findOne({ environment: environment.id })
    const services = await Service.find({ environment: environment.id })

    // Count environments in project (can't delete if only one)
    const envCount = await Environment.count({ project: project.id })

    // Determine if deletion is allowed
    const canDelete = !app && services.length === 0
    const isOnlyEnvironment = envCount === 1

    return {
      page: 'projects/environment-settings',
      props: {
        project,
        environment,
        canDelete,
        isOnlyEnvironment,
        hasApp: !!app,
        serviceCount: services.length
      }
    }
  }
}
