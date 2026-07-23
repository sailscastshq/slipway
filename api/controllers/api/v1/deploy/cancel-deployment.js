const deploymentCancellation = require('../../../../lib/deployment-cancellation')

const CANCELLABLE_STAGES = [
  'queued',
  'claimed',
  'initialization',
  'source_preparation',
  'image_build',
  'container_startup',
  'health_check',
  'cancel_requested'
]

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

    const deployment = await Deployment.findOne({ id: deploymentId }).populate(
      'environment'
    )

    if (!deployment) {
      throw 'notFound'
    }

    const environment = await Environment.findOne({
      id: deployment.environment.id
    }).populate('project')

    const project = await Project.findOne({
      id: environment.project.id
    }).populate('team')

    if (project.team.id !== user.team) {
      throw 'forbidden'
    }

    if (deployment.status === 'cancelled') {
      return {
        success: true,
        status: 'cancelled',
        message: 'Deployment is already cancelled'
      }
    }

    const job = await DeploymentJob.findOne({ deployment: deploymentId })
    if (
      !['pending', 'building', 'deploying'].includes(deployment.status) ||
      (job && !CANCELLABLE_STAGES.includes(job.stage))
    ) {
      throw {
        badRequest:
          job && !CANCELLABLE_STAGES.includes(job.stage)
            ? `Cannot cancel deployment after ${job.stage.replace(
                /_/g,
                ' '
              )} has started`
            : `Cannot cancel deployment with status: ${deployment.status}`
      }
    }

    const lease = await DeploymentLease.findOne({ deployment: deploymentId })
    if (job) {
      const claimedJob = await DeploymentJob.updateOne({
        id: job.id,
        stage: job.stage
      }).set({
        stage: lease ? 'cancel_requested' : 'cancelled'
      })

      if (!claimedJob) {
        const observedJob = await DeploymentJob.findOne({ id: job.id })
        if (!CANCELLABLE_STAGES.includes(observedJob?.stage)) {
          throw {
            badRequest: `Cannot cancel deployment after ${String(
              observedJob?.stage || 'completion'
            ).replace(/_/g, ' ')} has started`
          }
        }
      }
    }

    const cancellationMessage = `Cancelled by ${user.fullName || user.email}`
    const cancelled = await Deployment.updateOne({
      id: deploymentId,
      status: { in: ['pending', 'building', 'deploying'] }
    }).set({
      status: 'cancelled',
      errorMessage: cancellationMessage,
      finishedAt: Date.now()
    })

    if (!cancelled) {
      const observed = await Deployment.findOne({ id: deploymentId })
      if (observed?.status === 'cancelled') {
        return {
          success: true,
          status: 'cancelled',
          message: 'Deployment is already cancelled'
        }
      }

      throw {
        badRequest: `Cannot cancel deployment with status: ${observed?.status}`
      }
    }

    // An active worker keeps the lease while it unwinds so the next queued
    // deployment cannot overlap its resource cleanup.
    await Deployment.appendBuildLog(
      deploymentId,
      `\n⚠️ Deployment cancelled by ${user.fullName || user.email}\n`
    )

    deploymentCancellation.request(deploymentId, cancellationMessage)
    sails.log.info(`Deployment ${deploymentId} cancelled by ${user.email}`)

    return {
      success: true,
      status: 'cancelled',
      message: 'Deployment cancelled'
    }
  }
}
