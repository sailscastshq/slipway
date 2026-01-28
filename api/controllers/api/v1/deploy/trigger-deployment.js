module.exports = {
  friendlyName: 'Trigger deployment',

  description: 'Trigger a new deployment for an environment.',

  inputs: {
    projectId: {
      type: 'string',
      required: true,
      description: 'Project ID or slug'
    },
    environmentId: {
      type: 'string',
      required: true,
      description: 'Environment ID or slug'
    },
    gitCommit: {
      type: 'string',
      description: 'Git commit SHA to deploy'
    },
    gitBranch: {
      type: 'string',
      description: 'Git branch to deploy'
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

  fn: async function ({ projectId, environmentId, gitCommit, gitBranch }) {
    const user = await User.findOne({ id: this.req.session.userId })

    // Find project
    let project = await Project.findOne({ id: projectId }).populate('team')
    if (!project) {
      project = await Project.findOne({ slug: projectId }).populate('team')
    }

    if (!project) {
      throw 'notFound'
    }

    if (project.team.id !== user.team) {
      throw 'forbidden'
    }

    // Find environment
    let environment = await Environment.findOne({ id: environmentId, project: project.id })
    if (!environment) {
      environment = await Environment.findOne({ slug: environmentId, project: project.id })
    }

    if (!environment) {
      throw 'notFound'
    }

    // Create deployment record
    const deployment = await Deployment.create({
      status: 'pending',
      gitCommit,
      gitBranch,
      triggeredBy: user.id,
      triggerType: 'api',
      environment: environment.id,
      startedAt: Date.now()
    }).fetch()

    // TODO: Trigger actual deployment process (Docker build & run)
    // This will be implemented with helpers:
    // - sails.helpers.docker.buildImage()
    // - sails.helpers.docker.runContainer()
    // - sails.helpers.caddy.updateConfig()

    // For now, just update status to show it's queued
    await Deployment.updateOne({ id: deployment.id }).set({
      status: 'building'
    })

    sails.log.info(`Deployment ${deployment.id} triggered for ${project.slug}/${environment.slug}`)

    return {
      deployment: {
        id: deployment.id,
        status: 'building',
        message: 'Deployment started'
      }
    }
  }
}
