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

  fn: async function ({ id }) {
    const req = this.req
    const res = this.res

    // Check if deployment exists
    const deployment = await Deployment.findOne(id)

    if (!deployment) {
      throw 'notFound'
    }

    const stream = res.sse()

    // Send initial lifecycle state and user-facing release outcome.
    stream.send(await deploymentState(deployment))

    // If deployment is already complete, end immediately
    if (
      ['running', 'stopped', 'failed', 'cancelled'].includes(deployment.status)
    ) {
      stream.close()
      return
    }

    let lastStatus = deployment.status
    let lastLogLength = 0

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
        if (current.status !== lastStatus) {
          lastStatus = current.status
          stream.send(await deploymentState(current))
        }

        // Stream new build log output if available
        if (current.buildLogs && current.buildLogs.length > lastLogLength) {
          const newOutput = current.buildLogs.slice(lastLogLength)
          lastLogLength = current.buildLogs.length

          const lines = newOutput.split('\n').filter((l) => l.trim())
          for (const line of lines) {
            stream.send({ output: line })
          }
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

async function deploymentState(deployment) {
  return await sails.helpers.deployment.resolveOutcome.with({ deployment })
}
