module.exports = {
  friendlyName: 'Assert deployment lease',

  description:
    'Fence a deployment mutation so an expired or cancelled worker cannot change environment traffic or App state.',

  inputs: {
    deploymentId: {
      type: 'string',
      required: true
    },
    leaseToken: {
      type: 'string'
    }
  },

  exits: {
    success: {
      outputType: 'ref'
    }
  },

  fn: async function ({ deploymentId, leaseToken }) {
    if (!leaseToken) return { valid: true }

    const [lease, deployment] = await Promise.all([
      DeploymentLease.findOne({
        deployment: deploymentId,
        token: leaseToken,
        expiresAt: { '>': Date.now() }
      }),
      Deployment.findOne({ id: deploymentId })
    ])

    if (!lease) {
      return {
        valid: false,
        code: 'DEPLOYMENT_LEASE_LOST',
        message: `Deployment ${deploymentId} no longer owns its pipeline lease.`
      }
    }

    if (deployment?.status === 'cancelled') {
      return {
        valid: false,
        code: 'DEPLOYMENT_CANCELLED',
        message: `Deployment ${deploymentId} was cancelled.`
      }
    }

    return { valid: true }
  }
}
