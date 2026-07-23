const LEASE_TTL = 30 * 1000

module.exports = {
  friendlyName: 'Record deployment stage',

  description:
    'Persist pipeline progress and renew the matching fenced deployment lease.',

  inputs: {
    deploymentId: {
      type: 'string',
      required: true
    },
    leaseToken: {
      type: 'string'
    },
    stage: {
      type: 'string',
      required: true
    },
    candidateContainerName: {
      type: 'string'
    },
    previousContainerName: {
      type: 'string'
    },
    imageName: {
      type: 'string'
    },
    hostPort: {
      type: 'number'
    },
    buildContextPath: {
      type: 'string'
    }
  },

  fn: async function ({
    deploymentId,
    leaseToken,
    stage,
    candidateContainerName,
    previousContainerName,
    imageName,
    hostPort,
    buildContextPath
  }) {
    if (leaseToken) {
      const now = Date.now()
      const lease = await DeploymentLease.updateOne({
        deployment: deploymentId,
        token: leaseToken,
        expiresAt: { '>': now }
      }).set({
        stage,
        heartbeatAt: now,
        expiresAt: now + LEASE_TTL
      })

      if (!lease) {
        return {
          valid: false,
          code: 'DEPLOYMENT_LEASE_LOST',
          message: `Deployment ${deploymentId} no longer owns its pipeline lease.`
        }
      }

      const deployment = await Deployment.findOne({ id: deploymentId })
      if (deployment?.status === 'cancelled') {
        return {
          valid: false,
          code: 'DEPLOYMENT_CANCELLED',
          message: `Deployment ${deploymentId} was cancelled.`
        }
      }
    }

    const updates = { stage }
    if (candidateContainerName !== undefined)
      updates.candidateContainerName = candidateContainerName
    if (previousContainerName !== undefined)
      updates.previousContainerName = previousContainerName
    if (imageName !== undefined) updates.imageName = imageName
    if (hostPort !== undefined) updates.hostPort = hostPort
    if (buildContextPath !== undefined)
      updates.buildContextPath = buildContextPath

    const updatedJob = await DeploymentJob.updateOne({
      deployment: deploymentId,
      stage: { nin: ['cancel_requested', 'cancelled'] }
    }).set(updates)

    if (!updatedJob) {
      const job = await DeploymentJob.findOne({ deployment: deploymentId })
      if (['cancel_requested', 'cancelled'].includes(job?.stage)) {
        return {
          valid: false,
          code: 'DEPLOYMENT_CANCELLED',
          message: `Deployment ${deploymentId} was cancelled.`
        }
      }
    }

    return { valid: true }
  }
}
