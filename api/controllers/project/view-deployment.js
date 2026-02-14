module.exports = {
  friendlyName: 'View deployment',

  description: 'Display deployment detail page with build and deploy logs.',

  inputs: {
    slug: {
      type: 'string',
      required: true,
      description: 'Project slug'
    },
    deploymentId: {
      type: 'string',
      required: true,
      description: 'Deployment ID'
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

  fn: async function ({ slug, deploymentId }) {
    const user = await User.findOne({ id: this.req.session.userId }).populate('team')

    const project = await Project.findOne({ slug, team: user.team.id })

    if (!project) {
      throw { notFound: '/' }
    }

    const deployment = await Deployment.findOne({ id: deploymentId })
      .populate('triggeredBy')
      .populate('environment')

    if (!deployment) {
      throw { notFound: `/projects/${slug}` }
    }

    // Verify the deployment belongs to this project
    const environment = await Environment.findOne({ id: deployment.environment.id })
    if (!environment || environment.project !== project.id) {
      throw { notFound: `/projects/${slug}` }
    }

    const duration = Deployment.getDuration(deployment)

    // Check if this is the currently active deployment
    const app = await App.findOne({ environment: environment.id, isDefault: true }) || await App.findOne({ environment: environment.id })
    const isCurrentDeployment = app ? app.currentDeployment === deployment.id : false

    return {
      page: 'projects/deployment',
      props: {
        project,
        environment,
        deployment: {
          ...deployment,
          duration,
          isCurrentDeployment,
          triggeredBy: deployment.triggeredBy ? {
            id: deployment.triggeredBy.id,
            fullName: deployment.triggeredBy.fullName
          } : null
        }
      }
    }
  }
}
