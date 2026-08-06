module.exports = {
  friendlyName: 'Get deployment status',

  description: 'Get the status of a deployment.',

  inputs: {
    id: {
      type: 'string',
      required: true,
      description: 'Deployment ID'
    }
  },

  exits: {
    success: {
      statusCode: 200
    },
    notFound: {
      statusCode: 404
    },
    forbidden: {
      statusCode: 403
    }
  },

  fn: async function ({ id }) {
    const user = await User.findOne({ id: this.req.session.userId })

    const deployment = await Deployment.findOne(id)
      .populate('environment')
      .populate('triggeredBy')

    if (!deployment) {
      throw 'notFound'
    }

    // Get the project to check access
    const environment = await Environment.findOne({
      id: deployment.environment.id
    }).populate('project')

    const project = await Project.findOne({
      id: environment.project.id
    }).populate('team')

    if (project.team.id !== user.team) {
      throw 'forbidden'
    }

    const duration = Deployment.getDuration(deployment)
    const queuePosition = await DeploymentJob.getQueuePosition(deployment.id)
    const outcome = await sails.helpers.deployment.resolveOutcome.with({
      deployment
    })

    return {
      deployment: {
        id: deployment.id,
        ...outcome,
        gitCommit: deployment.gitCommit,
        gitBranch: deployment.gitBranch,
        gitMessage: deployment.gitMessage,
        triggeredBy: deployment.triggeredBy
          ? {
              id: deployment.triggeredBy.id,
              fullName: deployment.triggeredBy.fullName
            }
          : null,
        triggerType: deployment.triggerType,
        startedAt: deployment.startedAt,
        finishedAt: deployment.finishedAt,
        duration,
        queuePosition,
        errorMessage: deployment.errorMessage,
        configHash: deployment.configHash,
        configManifest: deployment.configManifest || [],
        environment: {
          id: deployment.environment.id,
          name: deployment.environment.name,
          slug: deployment.environment.slug
        }
      }
    }
  }
}
