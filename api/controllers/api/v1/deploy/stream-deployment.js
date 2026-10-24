/**
 * stream-deployment.js
 *
 * @description :: SSE endpoint for deployment status.
 *                 Streams build progress and status updates.
 */

module.exports = {
  friendlyName: 'Stream deployment',

  description: 'Server-Sent Events stream for deployment status.',

  inputs: {
    id: {
      type: 'string',
      required: true,
      description: 'The deployment ID.'
    },
    buildOffset: {
      type: 'number',
      min: 0,
      defaultsTo: 0,
      description: 'Number of persisted build-log characters already rendered.'
    },
    deployOffset: {
      type: 'number',
      min: 0,
      defaultsTo: 0,
      description: 'Number of persisted deploy-log characters already rendered.'
    }
  },

  exits: {
    success: {
      description: 'SSE stream started.'
    },
    notFound: {
      statusCode: 404,
      description: 'Deployment not found.'
    }
  },

  fn: async function ({ id, buildOffset, deployOffset }) {
    const req = this.req
    const res = this.res

    // Check if deployment exists
    const deployment = await Deployment.findOne(id)

    if (!deployment) {
      throw 'notFound'
    }

    const stream = res.sse()

    // Send initial lifecycle state and user-facing release outcome.
    const initialState = await deploymentState(deployment)
    stream.send(initialState)

    // If deployment is already complete, end immediately
    if (
      ['running', 'stopped', 'failed', 'cancelled'].includes(deployment.status)
    ) {
      stream.close()
      return
    }

    let lastState = JSON.stringify(initialState)
    let lastStatus = deployment.status
    let lastStage = initialState.stage || ''
    let lastBuildLogLength = Math.min(
      buildOffset,
      (deployment.buildLogs || '').length
    )
    let lastDeployLogLength = Math.min(
      deployOffset,
      displayDeployLogs(deployment).length
    )

    const checkInterval = setInterval(async () => {
      try {
        const current = await Deployment.findOne(id)

        if (!current) {
          stream.send({
            status: 'failed',
            outcome: 'failed',
            outcomeLabel: 'Failed',
            isCurrent: false,
            isActive: false,
            appId: null,
            error: 'Deployment not found'
          })
          clearInterval(checkInterval)
          stream.close()
          return
        }

        // Send status update if changed
        const job = await DeploymentJob.findOne({ deployment: id }).select([
          'stage'
        ])
        if (current.status !== lastStatus || job?.stage !== lastStage) {
          lastStatus = current.status
          lastStage = job?.stage
          const state = await deploymentState(current)
          const serialized = JSON.stringify(state)
          if (serialized !== lastState) {
            lastState = serialized
            stream.send(state)
          }
        }

        // Stream the exact persisted suffix so live output and a later reload
        // share line boundaries and timestamps.
        if (
          current.buildLogs &&
          current.buildLogs.length > lastBuildLogLength
        ) {
          const newOutput = current.buildLogs.slice(lastBuildLogLength)
          lastBuildLogLength = current.buildLogs.length
          stream.send({ output: newOutput, source: 'build' })
        }

        const deployLogs = displayDeployLogs(current)
        if (deployLogs.length > lastDeployLogLength) {
          const newOutput = deployLogs.slice(lastDeployLogLength)
          lastDeployLogLength = deployLogs.length
          stream.send({ output: newOutput, source: 'deploy' })
        }

        // End stream when deployment is complete
        if (
          ['running', 'stopped', 'failed', 'cancelled'].includes(current.status)
        ) {
          clearInterval(checkInterval)
          stream.close()
        }
      } catch (err) {
        sails.log.error('SSE stream error:', err)
      }
    }, 500)

    stream.onClose(() => {
      clearInterval(checkInterval)
    })

    return stream.wait()
  }
}

function displayDeployLogs(deployment) {
  return sails.hooks.secrets?.renderDeploymentLog
    ? sails.hooks.secrets.renderDeploymentLog(
        deployment.deployLogs || '',
        deployment.id
      )
    : deployment.deployLogs || ''
}

async function deploymentState(deployment) {
  return await sails.helpers.deployment.resolveOutcome.with({ deployment })
}
