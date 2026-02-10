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

    // Commit SSE headers immediately so Sails cannot override them
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      'Connection': 'keep-alive',
      'X-Accel-Buffering': 'no',
      'Content-Encoding': 'identity'
    })

    // Send initial status
    sendEvent(res, { status: deployment.status })

    // If deployment is already complete, end immediately
    if (['running', 'failed', 'cancelled'].includes(deployment.status)) {
      res.end()
      return
    }

    // Return a promise that only resolves when the stream ends.
    // This prevents Sails from calling res.end() prematurely.
    return new Promise((resolve) => {
      let lastStatus = deployment.status
      let lastLogLength = 0

      const checkInterval = setInterval(async () => {
        try {
          const current = await Deployment.findOne(id)

          if (!current) {
            sendEvent(res, { status: 'failed', error: 'Deployment not found' })
            clearInterval(checkInterval)
            res.end()
            resolve()
            return
          }

          // Send status update if changed
          if (current.status !== lastStatus) {
            lastStatus = current.status
            sendEvent(res, { status: current.status })
          }

          // Stream new build log output if available
          if (current.buildLogs && current.buildLogs.length > lastLogLength) {
            const newOutput = current.buildLogs.slice(lastLogLength)
            lastLogLength = current.buildLogs.length

            const lines = newOutput.split('\n').filter(l => l.trim())
            for (const line of lines) {
              sendEvent(res, { output: line })
            }
          }

          // End stream when deployment is complete
          if (['running', 'failed', 'cancelled'].includes(current.status)) {
            clearInterval(checkInterval)
            res.end()
            resolve()
          }
        } catch (err) {
          sails.log.error('SSE stream error:', err)
        }
      }, 500)

      // Clean up on client disconnect
      req.on('close', () => {
        clearInterval(checkInterval)
        resolve()
      })
    })
  }
}

function sendEvent(res, data) {
  res.write(`data: ${JSON.stringify(data)}\n\n`)
}
