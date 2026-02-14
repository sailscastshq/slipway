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

  fn: async function ({ projectSlug, environmentSlug, gitCommit, gitBranch, gitMessage, appSlug }) {
    const user = await User.findOne({ id: this.req.session.userId })

    const project = await Project.findOne({ slug: projectSlug }).populate('team')

    if (!project) {
      throw 'notFound'
    }

    if (project.team.id !== user.team) {
      throw 'forbidden'
    }

    const environment = await Environment.findOne({ project: project.id, slug: environmentSlug })

    if (!environment) {
      throw 'notFound'
    }

    // Resolve target app
    let targetApp
    if (appSlug) {
      targetApp = await App.findOne({ environment: environment.id, slug: appSlug })
    } else {
      targetApp = await App.findOne({ environment: environment.id, isDefault: true })
        || await App.findOne({ environment: environment.id })
    }

    // If git info not provided, get from most recent deployment
    let finalGitCommit = gitCommit
    let finalGitBranch = gitBranch
    let finalGitMessage = gitMessage

    if (!gitCommit || !gitBranch) {
      const lastDeployments = await Deployment.find({
        environment: environment.id,
        gitCommit: { '!=': null }
      }).sort('id DESC').limit(1)

      if (lastDeployments.length > 0) {
        const lastDeployment = lastDeployments[0]
        finalGitCommit = gitCommit || lastDeployment.gitCommit
        finalGitBranch = gitBranch || lastDeployment.gitBranch
        finalGitMessage = gitMessage || lastDeployment.gitMessage
      }
    }

    // Create deployment record
    const deployment = await Deployment.create({
      status: 'pending',
      gitCommit: finalGitCommit,
      gitBranch: finalGitBranch,
      gitMessage: finalGitMessage,
      triggeredBy: user.id,
      triggerType: 'api',
      environment: environment.id,
      app: targetApp ? targetApp.id : undefined,
      startedAt: Date.now()
    }).fetch()

    sails.log.info(`Deployment ${deployment.id} triggered for ${project.slug}/${environment.slug}`)

    // Audit log
    sails.helpers.audit.log.with({
      action: 'deployment.triggered',
      resourceType: 'deployment',
      resourceId: deployment.id,
      details: { projectSlug, environmentSlug, gitCommit: finalGitCommit },
      userId: user.id,
      teamId: project.team.id,
      ipAddress: this.req.ip
    }).exec(() => {})

    // Kick off the async deployment pipeline after returning the response
    process.nextTick(async () => {
      try {
        await sails.helpers.deploy.executePipeline.with({
          deploymentId: deployment.id,
          project,
          environment,
          app: targetApp
        })
      } catch (err) {
        sails.log.error(`Deployment ${deployment.id} failed: ${err.message || err}`)
      }
    })

    return {
      deployment: {
        id: deployment.id,
        status: 'pending',
        message: 'Deployment started'
      }
    }
  }
}
