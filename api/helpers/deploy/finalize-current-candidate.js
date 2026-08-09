module.exports = {
  friendlyName: 'Finalize current candidate',

  description:
    'Finalize durable deployment state when the candidate already owns app traffic after an interrupted attempt.',

  inputs: {
    deploymentId: {
      type: 'string',
      required: true
    },
    leaseToken: {
      type: 'string'
    },
    environmentId: {
      type: 'string',
      required: true
    },
    appId: {
      type: 'string',
      required: true
    }
  },

  exits: {
    success: {
      outputType: 'ref'
    }
  },

  fn: async function ({ deploymentId, leaseToken, environmentId, appId }) {
    const [app, job] = await Promise.all([
      App.findOne({ id: appId }),
      DeploymentJob.findOne({ deployment: deploymentId })
    ])
    if (
      !app ||
      !app.containerName ||
      String(app.currentDeployment) !== String(deploymentId)
    ) {
      const error = new Error(
        `Deployment ${deploymentId} no longer owns app traffic.`
      )
      error.code = 'DEPLOYMENT_TRAFFIC_OWNER_CHANGED'
      throw error
    }

    requireValidLease(
      await sails.helpers.deploy.assertDeploymentLease.with({
        deploymentId,
        leaseToken
      })
    )

    await sails.helpers.caddy.updateRoute.with({
      environmentId
    })

    // Route repair can take long enough for ownership to change. Fence again
    // before retiring the previous release or releasing port state.
    requireValidLease(
      await sails.helpers.deploy.assertDeploymentLease.with({
        deploymentId,
        leaseToken
      })
    )

    if (
      job?.previousContainerName &&
      job.previousContainerName !== app.containerName
    ) {
      try {
        await sails.helpers.docker.stopContainer.with({
          containerName: job.previousContainerName
        })
      } catch (error) {
        if (error !== 'notFound' && error?.code !== 'notFound') throw error
      }
    }

    if (job?.hostPort) {
      await sails.helpers.docker.releasePort.with({
        hostPort: job.hostPort,
        ownerType: 'deployment',
        ownerId: String(deploymentId)
      })
    } else {
      await PortReservation.destroy({
        ownerType: 'deployment',
        ownerId: String(deploymentId)
      })
    }

    const stopCriteria = {
      environment: environmentId,
      app: appId,
      status: 'running',
      id: { '<': deploymentId }
    }
    await Deployment.update(stopCriteria).set({ status: 'stopped' })

    requireValidLease(
      await sails.helpers.deploy.updateDeploymentForLease.with({
        deploymentId,
        leaseToken,
        values: {
          status: 'running',
          errorMessage: null,
          finishedAt: Date.now()
        }
      })
    )
    requireValidLease(
      await sails.helpers.deploy.recordDeploymentStage.with({
        deploymentId,
        leaseToken,
        stage: 'complete'
      })
    )

    await Deployment.appendDeployLog(
      deploymentId,
      'Recovered the already-committed candidate, retired the previous release, and finalized this deployment.\n'
    )

    return { action: 'finalized', app }
  }
}

function requireValidLease(result) {
  if (!result || result.valid !== false) return
  const error = new Error(result.message)
  error.code = result.code
  throw error
}
