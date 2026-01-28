module.exports = {
  friendlyName: 'View CLI login',

  description: 'Display the CLI login confirmation page.',

  inputs: {
    code: {
      type: 'string',
      required: true,
      description: 'The CLI auth session code.'
    }
  },

  exits: {
    success: {
      responseType: 'inertia'
    },
    invalidCode: {
      responseType: 'redirect',
      description: 'Invalid or expired code.'
    }
  },

  fn: async function ({ code }) {
    // Verify the code exists and is valid
    const authSessions = sails.helpers.cli.authSessions()
    const session = authSessions.get(code)

    if (!session) {
      // Invalid or expired code
      return this.res.redirect('/login?error=invalid_cli_code')
    }

    // Check if user is logged in
    const isLoggedIn = !!this.req.session.userId
    let user = null

    if (isLoggedIn) {
      user = await User.findOne({ id: this.req.session.userId })
    }

    return {
      page: 'cli/login',
      code,
      isLoggedIn,
      user: user ? { email: user.email, fullName: user.fullName } : null
    }
  }
}
