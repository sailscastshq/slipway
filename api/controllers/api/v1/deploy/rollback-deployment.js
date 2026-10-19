module.exports = {
  friendlyName: 'Rollback deployment',

  description:
    'Roll back to a previous deployment by reusing its Docker image.',

  inputs: {
    projectSlug: {
      type: 'string',
      required: true,
      description: 'Project slug'
    },
    environmentSlug: {
      type: 'string',
      defaultsTo: 'production',
      description: 'Environment slug'
    },
    deploymentId: {
      type: 'string',
      required: true,
      description: 'ID of the deployment to roll back to'
    },
    expectedCurrent: { type: 'string', required: true },
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
    deploymentId,
    appSlug,
    expectedCurrent
  }) {
    const user = await User.forRequest(this.req)
    const project = await Project.findOne({ slug: projectSlug }).populate(
      'team'
    )

    if (!project) throw 'notFound'
    if (project.team.id !== user.team) throw 'forbidden'

    const environment = await Environment.findOne({
      project: project.id,
      slug: environmentSlug
    })
    if (!environment) throw 'notFound'

    const targetApp = appSlug
      ? await App.findOne({ environment: environment.id, slug: appSlug })
      : (await App.findOne({
          environment: environment.id,
          isDefault: true
        })) || (await App.findOne({ environment: environment.id }))

    if (!targetApp) throw 'notFound'
    const recovery = await sails.helpers.deploy.resolveRecoveryTarget.with({
      app: targetApp,
      deploymentId,
      expectedCurrent
    })
    if (!recovery.available) throw { badRequest: { message: recovery.reason } }
    const targetDeployment = recovery.target

    const queued = await sails.helpers.deploy.queueDeployment
      .with({
        values: {
          gitCommit: targetDeployment.gitCommit,
          gitBranch: targetDeployment.gitBranch,
          gitMessage: `Rollback to deployment ${targetDeployment.id}`,
          triggeredBy: user.id,
          triggerType: 'api',
          environment: environment.id,
          imageId: recovery.imageId,
          imageName: targetDeployment.imageName || recovery.imageId
        },
        app: targetApp,
        kind: 'rollback',
        targetDeploymentId: targetDeployment.id,
        expectedCurrent
      })
      .intercept('cleanupInProgress', (error) => ({
        badRequest: error.raw || error
      }))
    const rollback = queued.deployment

    sails.log.info(
      `Rollback ${rollback.id} triggered for ${project.slug}/${environment.slug} → deployment ${deploymentId}`
    )

    return {
      deployment: {
        id: rollback.id,
        status: 'pending',
        message: 'Rollback queued',
        queuePosition: queued.queuePosition
      }
    }
  }
}
