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
    const user = await User.forRequest(this.req, { populateTeam: true })

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
    const environment = await Environment.findOne({
      id: deployment.environment.id
    })
    if (!environment || environment.project !== project.id) {
      throw { notFound: `/projects/${slug}` }
    }

    const duration = Deployment.getDuration(deployment)
    const queuePosition = await DeploymentJob.getQueuePosition(deployment.id)

    const outcome = await sails.helpers.deployment.resolveOutcome.with({
      deployment
    })

    const app = outcome.appId
      ? await App.findOne({ id: outcome.appId, environment: environment.id })
      : null
    const recovery = app
      ? await sails.helpers.deploy.resolveRecoveryTarget.with({
          app,
          ...(outcome.isCurrent ? {} : { deploymentId: String(deployment.id) })
        })
      : {
          available: false,
          reason: 'This legacy deployment has no verified app recovery target.'
        }
    const { target, bootstrapState, ...recoveryDisplay } = recovery
    if (target) recoveryDisplay.gitCommit = target.gitCommit || null

    return {
      page: 'projects/deployment',
      props: {
        project,
        environment,
        recovery: recoveryDisplay,
        deployment: {
          ...deployment,
          duration,
          queuePosition,
          ...outcome,
          isCurrentDeployment: outcome.isCurrent,
          triggeredBy: deployment.triggeredBy
            ? {
                id: deployment.triggeredBy.id,
                fullName: deployment.triggeredBy.fullName
              }
            : null
        }
      }
    }
  }
}
