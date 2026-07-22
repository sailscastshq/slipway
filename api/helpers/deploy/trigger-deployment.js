module.exports = {
  friendlyName: 'Trigger deployment',

  description:
    'Resolve, preflight, record, and queue a deployment through the shared durable pipeline.',

  inputs: {
    project: {
      type: 'ref',
      required: true
    },
    environment: {
      type: 'ref',
      required: true
    },
    user: {
      type: 'ref',
      required: true
    },
    app: {
      type: 'ref'
    },
    appSlug: {
      type: 'string'
    },
    requireExplicitApp: {
      type: 'boolean',
      defaultsTo: false
    },
    gitCommit: {
      type: 'string'
    },
    gitBranch: {
      type: 'string'
    },
    gitMessage: {
      type: 'string'
    },
    triggerType: {
      type: 'string',
      isIn: ['manual', 'cli', 'webhook', 'api', 'content'],
      required: true
    },
    ipAddress: {
      type: 'string'
    }
  },

  exits: {
    success: {
      outputType: 'ref'
    },
    appNotFound: {},
    appSelectionRequired: {},
    sourceUnavailable: {
      outputType: 'ref'
    }
  },

  fn: async function ({
    project,
    environment,
    user,
    app,
    appSlug,
    requireExplicitApp,
    gitCommit,
    gitBranch,
    gitMessage,
    triggerType,
    ipAddress
  }) {
    const resolved = await sails.helpers.deploy.resolveTargetApp
      .with({
        environment,
        app,
        appSlug,
        requireExplicit: requireExplicitApp
      })
      .intercept('appNotFound', 'appNotFound')
      .intercept('appSelectionRequired', 'appSelectionRequired')
    const targetApp = resolved.app
    const sourceReadiness = await sails.helpers.deploy.getSourceReadiness.with({
      project,
      environment,
      app: targetApp
    })

    if (!sourceReadiness.available) {
      throw {
        sourceUnavailable: {
          code: 'deploymentSourceUnavailable',
          message: sourceReadiness.message,
          guidance:
            'Run `slipway slide` from your project or connect a repository, then try again.'
        }
      }
    }

    let finalGitCommit = gitCommit
    let finalGitBranch = gitBranch
    let finalGitMessage = gitMessage

    if (sourceReadiness.mode === 'repository' && (!gitCommit || !gitBranch)) {
      const previousCriteria = {
        environment: environment.id,
        gitCommit: { '!=': null },
        or: targetApp.isDefault
          ? [{ app: targetApp.id }, { app: null }]
          : [{ app: targetApp.id }]
      }
      const previous = await Deployment.find(previousCriteria)
        .sort('id DESC')
        .limit(1)

      if (previous.length > 0) {
        finalGitCommit = gitCommit || previous[0].gitCommit
        finalGitBranch = gitBranch || previous[0].gitBranch
        finalGitMessage = gitMessage || previous[0].gitMessage
      }
    }

    const queued = await sails.helpers.deploy.queueDeployment.with({
      values: {
        gitCommit: finalGitCommit,
        gitBranch: finalGitBranch,
        gitMessage: finalGitMessage,
        triggeredBy: user.id,
        triggerType,
        environment: environment.id
      },
      app: targetApp
    })

    sails.helpers.audit.log
      .with({
        action: 'deployment.triggered',
        resourceType: 'deployment',
        resourceId: queued.deployment.id,
        details: {
          projectSlug: project.slug,
          environmentSlug: environment.slug,
          appSlug: targetApp.slug,
          gitCommit: finalGitCommit,
          triggerType
        },
        userId: user.id,
        teamId: normalizeId(project.team),
        ipAddress
      })
      .exec(() => {})

    return {
      ...queued,
      app: targetApp,
      sourceReadiness,
      gitCommit: finalGitCommit,
      gitBranch: finalGitBranch,
      gitMessage: finalGitMessage
    }
  }
}

function normalizeId(value) {
  return value && typeof value === 'object' ? value.id : value
}
