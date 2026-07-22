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

    // Resolve target app
    let targetApp
    if (appSlug) {
      targetApp = await App.findOne({
        environment: environment.id,
        slug: appSlug
      })
      if (!targetApp) {
        throw 'notFound'
      }
    } else {
      targetApp =
        (await App.findOne({ environment: environment.id, isDefault: true })) ||
        (await App.findOne({ environment: environment.id }))
    }

    // Source availability is a request precondition. Keep this check fast and
    // side-effect free; repository synchronization belongs in the recorded
    // deployment pipeline so failures have durable logs and status.
    const sourceReadiness = await sails.helpers.deploy.getSourceReadiness.with({
      project,
      environment,
      app: targetApp
    })

    if (!sourceReadiness.available) {
      throw {
        badRequest: {
          code: 'deploymentSourceUnavailable',
          message: sourceReadiness.message,
          guidance:
            'Run `slipway slide` from your project or connect a repository, then try again.'
        }
      }
    }

    // Repository deployments may reuse metadata from the most recent deploy
    // for this app. Pushed-source deploys must not inherit stale Git metadata.
    let finalGitCommit = gitCommit
    let finalGitBranch = gitBranch
    let finalGitMessage = gitMessage

    if (sourceReadiness.mode === 'repository' && (!gitCommit || !gitBranch)) {
      const previousDeploymentCriteria = {
        environment: environment.id,
        gitCommit: { '!=': null }
      }
      if (targetApp) {
        previousDeploymentCriteria.or = targetApp.isDefault
          ? [{ app: targetApp.id }, { app: null }]
          : [{ app: targetApp.id }]
      }

      const lastDeployments = await Deployment.find(previousDeploymentCriteria)
        .sort('id DESC')
        .limit(1)

      if (lastDeployments.length > 0) {
        const lastDeployment = lastDeployments[0]
        finalGitCommit = gitCommit || lastDeployment.gitCommit
        finalGitBranch = gitBranch || lastDeployment.gitBranch
        finalGitMessage = gitMessage || lastDeployment.gitMessage
      }
    }

    const queued = await sails.helpers.deploy.queueDeployment.with({
      values: {
        gitCommit: finalGitCommit,
        gitBranch: finalGitBranch,
        gitMessage: finalGitMessage,
        triggeredBy: user.id,
        triggerType: 'api',
        environment: environment.id
      },
      app: targetApp
    })
    const deployment = queued.deployment

    sails.log.info(
      `Deployment ${deployment.id} triggered for ${project.slug}/${environment.slug}`
    )

    // Audit log
    sails.helpers.audit.log
      .with({
        action: 'deployment.triggered',
        resourceType: 'deployment',
        resourceId: deployment.id,
        details: { projectSlug, environmentSlug, gitCommit: finalGitCommit },
        userId: user.id,
        teamId: project.team.id,
        ipAddress: this.req.ip
      })
      .exec(() => {})

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
