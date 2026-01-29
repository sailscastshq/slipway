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

    // Get the logged-in user with their team
    const user = await User.findOne({ id: this.req.session.userId }).populate('team')

    if (!user) {
      throw 'unauthorized'
    }

    // Generate a session token for the CLI
    const crypto = require('crypto')
    const rawToken = crypto.randomBytes(32).toString('hex')
    const sessionToken = `sl_${rawToken}`

    // Confirm the session with user and team info
    const confirmed = authSessions.confirm(code, {
      id: user.id,
      email: user.email,
      fullName: user.fullName,
      team: user.team ? {
        id: user.team.id,
        name: user.team.name,
        slug: user.team.slug
      } : null
    }, sessionToken)

    // Store this token in the database for persistence
    // Hash only the random part (without sl_ prefix) for lookup
    const hashedToken = crypto.createHash('sha256').update(rawToken).digest('hex')

    await CliToken.create({
      token: hashedToken,
      user: user.id,
      name: 'CLI',
      lastUsedAt: new Date()
    })

    return {
      success: true,
      message: 'CLI authentication confirmed. You can close this window.'
    }
  }
}
