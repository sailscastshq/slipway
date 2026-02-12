module.exports = {
  friendlyName: 'Cancel deployment',

  description: 'Cancel a running deployment.',

  inputs: {
    deploymentId: {
      type: 'string',
      required: true,
      description: 'Deployment ID to cancel'
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
    },
    badRequest: {
      responseType: 'badRequest'
    }
  },

  fn: async function ({ deploymentId }) {
    const user = await User.findOne({ id: this.req.session.userId })

    const deployment = await Deployment.findOne({ id: deploymentId })
      .populate('environment')

    if (!deployment) {
      throw 'notFound'
    }

    const environment = await Environment.findOne({ id: deployment.environment.id })
      .populate('project')

    const project = await Project.findOne({ id: environment.project.id })
      .populate('team')

    if (project.team.id !== user.team) {
      throw 'forbidden'
    }

    // Can only cancel pending or building deployments
    if (!['pending', 'building', 'deploying'].includes(deployment.status)) {
      throw { badRequest: `Cannot cancel deployment with status: ${deployment.status}` }
    }

    // Mark as cancelled
    await Deployment.updateOne({ id: deploymentId }).set({
      status: 'cancelled',
      errorMessage: `Cancelled by ${user.fullName || user.email}`,
      finishedAt: Date.now()
    })

    await Deployment.appendBuildLog(deploymentId, `\n⚠️ Deployment cancelled by ${user.fullName || user.email}\n`)

    sails.log.info(`Deployment ${deploymentId} cancelled by ${user.email}`)

    return {
      success: true,
      message: 'Deployment cancelled'
    }
  }
}
