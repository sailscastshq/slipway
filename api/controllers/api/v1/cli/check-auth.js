/**
 * check-cli-auth.js
 *
 * @description :: Check the status of a CLI authentication session.
 *                 Called by CLI to poll for authentication completion.
 */

module.exports = {
  friendlyName: 'Check CLI auth',

  description: 'Check if a CLI authentication session has been confirmed.',

  inputs: {
    code: {
      type: 'string',
      required: true,
      description: 'The CLI auth session code.'
    }
  },

  exits: {
    success: {
      description: 'Returns the session status.'
    },
    notFound: {
      statusCode: 404,
      description: 'Session not found or expired.'
    }
  },

  fn: async function ({ code }) {
    const authSessions = sails.helpers.cli.authSessions()

    const session = authSessions.get(code)

    if (!session) {
      throw 'notFound'
    }

    if (session.status === 'authenticated') {
      // Clean up the session after successful retrieval
      authSessions.delete(code)

      return {
        status: 'authenticated',
        token: session.sessionToken,
        user: session.user
      }
    }

    return {
      status: 'pending'
    }
  }
}
