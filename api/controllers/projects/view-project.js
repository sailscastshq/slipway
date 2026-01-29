module.exports = {
  friendlyName: 'View project',

  description: 'Display project detail page with environments and deployments.',

  inputs: {
    slug: {
      type: 'string',
      required: true,
      description: 'Project slug'
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

  fn: async function ({ slug }) {
    const user = await User.findOne({ id: this.req.session.userId }).populate('team')

    const project = await Project.findOne({ slug, team: user.team.id })
      .populate('environments')

    if (!project) {
      throw { notFound: '/' }
    }

    // For each environment, get app status and recent deployments
    const environments = await Promise.all(
      project.environments.map(async (env) => {
        const app = await App.findOne({ environment: env.id })
        const deployments = await Deployment.find({ environment: env.id })
          .sort('createdAt DESC')
          .limit(5)
          .populate('triggeredBy')

        const fullDomain = await Environment.getFullDomain(env.id)

        return {
          ...env,
          app: app || null,
          deployments,
          fullDomain
        }
      })
    )

    return {
      page: 'projects/show',
      props: {
        project,
        environments
      }
    }
  }
}
