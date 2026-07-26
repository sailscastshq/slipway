module.exports = {
  friendlyName: 'Trigger deployment',

  description: 'Trigger a new deployment for an environment.',

  inputs: {
    projectSlug: {
      type: 'string',
      required: true,
      description: 'Project slug'
    },
    environmentSlug: {
      type: 'string',
      defaultsTo: 'production',
      description: 'Environment slug (defaults to production)'
    },
    gitCommit: {
      type: 'string',
      description: 'Git commit SHA to deploy'
    },
    gitBranch: {
      type: 'string',
      description: 'Git branch to deploy'
    },
    gitMessage: {
      type: 'string',
      description: 'Git commit message'
    },
    appSlug: {
      type: 'string',
      description: 'Target app slug (defaults to default app)'
    }
  },

  exits: {
    success: {
      statusCode: 202
    },
    notFound: {
      statusCode: 404
    },
    forbidden: {
      statusCode: 403
    },
    badRequest: {
      responseType: 'badRequest'
    }
  },

  fn: async function ({
    projectSlug,
    environmentSlug,
    gitCommit,
    gitBranch,
    gitMessage,
    appSlug
  }) {
    const user = await User.findOne({ id: this.req.session.userId })

    const project = await Project.findOne({ slug: projectSlug }).populate(
      'team'
    )

    if (!project) {
      throw 'notFound'
    }

    if (project.team.id !== user.team) {
      throw 'forbidden'
    }

    const environment = await Environment.findOne({
      project: project.id,
      slug: environmentSlug
    })

    if (!environment) {
      throw 'notFound'
    }

    const queued = await sails.helpers.deploy.triggerDeployment
      .with({
        project,
        environment,
        user,
        appSlug,
        gitCommit,
        gitBranch,
        gitMessage,
        triggerType: 'api',
        ipAddress: this.req.ip
      })
      .intercept('appNotFound', 'notFound')
      .intercept('sourceUnavailable', (error) => ({
        badRequest: error.raw || error
      }))
      .intercept('cleanupInProgress', (error) => ({
        badRequest: error.raw || error
      }))
    const deployment = queued.deployment

    sails.log.info(
      `Deployment ${deployment.id} triggered for ${project.slug}/${environment.slug}`
    )

    return {
      deployment: {
        id: deployment.id,
        status: 'pending',
        message: 'Deployment queued',
        queuePosition: queued.queuePosition
      }
    }
  }
}
