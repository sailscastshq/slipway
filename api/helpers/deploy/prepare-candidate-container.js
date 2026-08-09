module.exports = {
  friendlyName: 'Prepare candidate container',

  description:
    'Make a deployment-scoped Docker container name safe to reuse without ever removing the app container that owns traffic.',

  inputs: {
    deploymentId: {
      type: 'string',
      required: true
    },
    leaseToken: {
      type: 'string'
    },
    appId: {
      type: 'string'
    },
    containerName: {
      type: 'string',
      required: true
    }
  },

  exits: {
    success: {
      outputType: 'ref'
    }
  },

  fn: async function ({ deploymentId, leaseToken, appId, containerName }) {
    requireValidLease(
      await sails.helpers.deploy.assertDeploymentLease.with({
        deploymentId,
        leaseToken
      })
    )

    let status
    try {
      status = await sails.helpers.docker.getContainerStatus.with({
        containerName,
        fresh: true
      })
    } catch (error) {
      if (error !== 'notFound' && error?.code !== 'notFound') throw error
      status = null
    }

    if (!status) return { action: 'ready' }

    const app = appId ? await App.findOne({ id: appId }) : null
    const ownsTraffic = app?.containerName === containerName
    const isCommitted = Boolean(
      ownsTraffic &&
        app.currentDeployment &&
        String(app.currentDeployment) === String(deploymentId)
    )

    if (ownsTraffic) {
      return {
        action:
          isCommitted && status.running ? 'current' : 'traffic-owner-conflict',
        app,
        status
      }
    }

    // Recheck the fencing token immediately before the destructive mutation.
    // An expired worker must not remove a candidate owned by its successor.
    requireValidLease(
      await sails.helpers.deploy.assertDeploymentLease.with({
        deploymentId,
        leaseToken
      })
    )

    await sails.helpers.docker.stopContainer.with({ containerName })
    await Deployment.appendDeployLog(
      deploymentId,
      `Removed stale candidate container before retry: ${containerName}\n`
    )

    return { action: 'removed', status }
  }
}

function requireValidLease(result) {
  if (!result || result.valid !== false) return
  const error = new Error(result.message)
  error.code = result.code
  throw error
}
