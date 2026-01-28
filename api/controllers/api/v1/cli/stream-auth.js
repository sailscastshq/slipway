/**
 * stream-cli-auth.js
 *
 * @description :: SSE endpoint for CLI authentication.
 *                 Streams auth status updates to the CLI.
 */

module.exports = {
  friendlyName: 'Stream CLI auth',

  description: 'Server-Sent Events stream for CLI authentication status.',

  inputs: {
    code: {
      type: 'string',
      required: true,
      description: 'The CLI auth session code.'
    }
  },

  exits: {
    success: {
      description: 'SSE stream started.'
    },
    notFound: {
      statusCode: 404,
      description: 'Session not found.'
    }
  },

  fn: async function ({ code }) {
    const req = this.req
    const res = this.res

    const authSessions = sails.helpers.cli.authSessions()
    const session = authSessions.get(code)

    if (!session) {
      throw 'notFound'
    }

    // Set up SSE headers
    res.setHeader('Content-Type', 'text/event-stream')
    res.setHeader('Cache-Control', 'no-cache')
    res.setHeader('Connection', 'keep-alive')
    res.setHeader('X-Accel-Buffering', 'no') // Disable nginx buffering

    // Send initial status
    sendEvent(res, { status: 'pending' })

    // Poll for status changes (the session is updated when user confirms)
    const checkInterval = setInterval(() => {
      const currentSession = authSessions.get(code)

      if (!currentSession) {
        // Session expired or deleted
        sendEvent(res, { status: 'expired' })
        clearInterval(checkInterval)
        res.end()
        return
      }

      if (currentSession.status === 'authenticated') {
        sendEvent(res, {
          status: 'authenticated',
          token: currentSession.sessionToken,
          user: currentSession.user
        })
        // Clean up the session
        authSessions.delete(code)
        clearInterval(checkInterval)
        res.end()
        return
      }

      // Send heartbeat to keep connection alive
      res.write(': heartbeat\n\n')
    }, 1000)

    // Clean up on client disconnect
    req.on('close', () => {
      clearInterval(checkInterval)
    })

    // Keep the connection open (don't return)
    return
  }
}

function sendEvent(res, data) {
  res.write(`data: ${JSON.stringify(data)}\n\n`)
}
