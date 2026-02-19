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

    const stream = res.sse()

    // Send initial status
    stream.send({ status: 'pending' })

    // Poll for status changes (the session is updated when user confirms)
    const checkInterval = setInterval(() => {
      const currentSession = authSessions.get(code)

      if (!currentSession) {
        // Session expired or deleted
        stream.send({ status: 'expired' })
        clearInterval(checkInterval)
        stream.close()
        return
      }

      if (currentSession.status === 'authenticated') {
        stream.send({
          status: 'authenticated',
          token: currentSession.sessionToken,
          user: currentSession.user
        })
        // Clean up the session
        authSessions.delete(code)
        clearInterval(checkInterval)
        stream.close()
        return
      }

      // Send heartbeat to keep connection alive
      stream.heartbeat()
    }, 1000)

    stream.onClose(() => {
      clearInterval(checkInterval)
    })

    return stream.wait()
  }
}
