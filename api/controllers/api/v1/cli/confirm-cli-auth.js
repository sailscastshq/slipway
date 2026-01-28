/**
 * confirm-cli-auth.js
 *
 * @description :: Confirm a CLI authentication session.
 *                 Called by the browser when user approves CLI login.
 *                 Requires the user to be logged in.
 */

module.exports = {
  friendlyName: 'Confirm CLI auth',

  description: 'Confirm a CLI authentication session from the browser.',

  inputs: {
    code: {
      type: 'string',
      required: true,
      description: 'The CLI auth session code to confirm.'
    }
  },

  exits: {
    success: {
      description: 'CLI auth session confirmed.'
    },
    notFound: {
      statusCode: 404,
      description: 'Session not found or expired.'
    },
    unauthorized: {
      statusCode: 401,
      description: 'User must be logged in.'
    }
  },

  fn: async function ({ code }) {
    // User must be logged in
    if (!this.req.session.userId) {
      throw 'unauthorized'
    }

    const authSessions = sails.helpers.cli.authSessions()

    const session = authSessions.get(code)

    if (!session) {
      throw 'notFound'
    }

    // Get the logged-in user
    const user = await User.findOne({ id: this.req.session.userId })

    if (!user) {
      throw 'unauthorized'
    }

    // Generate a session token for the CLI
    // We'll use the same session ID format as Sails
    const crypto = require('crypto')
    const sessionToken = crypto.randomBytes(32).toString('hex')

    // Confirm the session
    authSessions.confirm(code, {
      id: user.id,
      email: user.email,
      fullName: user.fullName
    }, sessionToken)

    // Store this token as a valid CLI session
    // We'll create a simple token-to-user mapping
    if (!sails.cliTokens) {
      sails.cliTokens = new Map()
    }
    sails.cliTokens.set(sessionToken, user.id)

    return {
      success: true,
      message: 'CLI authentication confirmed. You can close this window.'
    }
  }
}
