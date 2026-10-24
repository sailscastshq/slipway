const { setTimeout: delay } = require('node:timers/promises')
module.exports = {
  friendlyName: 'Await trusted local CI result',
  inputs: {
    appId: { type: 'string', required: true },
    contextPath: { type: 'string', required: true },
    deploymentId: { type: 'string', required: true },
    leaseToken: { type: 'string' },
    signal: { type: 'ref' },
    waitMs: { type: 'number', defaultsTo: 1200000 }
  },
  exits: { success: { outputType: 'ref' } },
  fn: async function ({
    appId,
    contextPath,
    deploymentId,
    leaseToken,
    signal,
    waitMs
  }) {
    const deadline = Date.now() + Math.min(Math.max(waitMs, 0), 1200000)
    let revision,
      announced = false
    while (true) {
      require('../../lib/deployment-cancellation').throwIfCancelled(
        signal,
        deploymentId
      )
      const lease = await sails.helpers.deploy.assertDeploymentLease.with({
        deploymentId,
        leaseToken
      })
      if (!lease.valid) {
        const error = new Error(
          lease.message || 'The deployment lease was lost while waiting for CI.'
        )
        error.code = lease.code || 'DEPLOYMENT_LEASE_LOST'
        throw error
      }
      const result = await sails.helpers.ci.getDeploymentAdmission.with({
        appId,
        contextPath,
        ...(revision ? { expectedPolicyRevision: revision } : {})
      })
      if (result.allowed) return result
      revision ||= result.policyRevision
      if (!announced) {
        await Deployment.appendBuildLog(deploymentId, result.reason + '\n')
        announced = true
      }
      if (Date.now() >= deadline)
        throw new Error(
          'Trusted local CI did not arrive before the deployment deadline. The current release is unchanged.'
        )
      try {
        await delay(Math.min(2000, deadline - Date.now()), undefined, {
          signal
        })
      } catch (error) {
        require('../../lib/deployment-cancellation').throwIfCancelled(
          signal,
          deploymentId
        )
        throw error
      }
    }
  }
}
