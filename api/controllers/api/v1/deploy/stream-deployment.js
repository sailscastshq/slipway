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
    const deployment = await Deployment.findOne({ id })

    if (!deployment) {
      throw 'notFound'
    }

    // Set up SSE headers
    res.setHeader('Content-Type', 'text/event-stream')
    res.setHeader('Cache-Control', 'no-cache')
    res.setHeader('Connection', 'keep-alive')
    res.setHeader('X-Accel-Buffering', 'no') // Disable nginx buffering

    // Send initial status
    sendEvent(res, { status: deployment.status })

    // If deployment is already complete, end immediately
    if (['running', 'failed', 'cancelled'].includes(deployment.status)) {
      sendEvent(res, { status: deployment.status })
      res.end()
      return
    }

    let lastStatus = deployment.status
    let lastLogLength = 0

    // Poll for status changes
    const checkInterval = setInterval(async () => {
      try {
        const current = await Deployment.findOne({ id })

        if (!current) {
          sendEvent(res, { status: 'failed', error: 'Deployment not found' })
          clearInterval(checkInterval)
          res.end()
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

          // Send output line by line
          const lines = newOutput.split('\n').filter(l => l.trim())
          for (const line of lines) {
            sendEvent(res, { output: line })
          }
        }

        // End stream when deployment is complete
        if (['running', 'failed', 'cancelled'].includes(current.status)) {
          clearInterval(checkInterval)
          res.end()
        }
      } catch (err) {
        sails.log.error('SSE stream error:', err)
      }
    }, 500)

    // Clean up on client disconnect
    req.on('close', () => {
      clearInterval(checkInterval)
    })

    // Keep the connection open
    return
  }
}

function sendEvent(res, data) {
  res.write(`data: ${JSON.stringify(data)}\n\n`)
}
