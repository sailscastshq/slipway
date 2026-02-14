module.exports = {
  friendlyName: 'View CLI authorize',

  description: 'Display the CLI authorization page.',

  inputs: {
    code: {
      type: 'string',
      required: true,
      description: 'The CLI auth session code.'
    },
    status: {
      type: 'string',
      isIn: ['success'],
      description: 'Authorization status (for preserving state on refresh)'
    }
  },

  exits: {
    success: {
      responseType: 'inertia'
    },
    invalidCode: {
      responseType: 'redirect'
    }
  },

  fn: async function ({ code, status }) {
    // If status=success, show success screen (session may already be consumed)
    if (status === 'success') {
      return {
        page: 'cli/authorize',
        props: {
          code,
          isLoggedIn: true,
          user: null,
          status: 'success'
        }
      }
    }

    // Verify the code exists and is valid
    const authSessions = sails.helpers.cli.authSessions()
    const session = authSessions.get(code)

    if (!session) {
      // Invalid or expired code - redirect to an error page
      throw { invalidCode: '/login?error=invalid_cli_code' }
    }

    // Check if user is logged in
    const isLoggedIn = !!this.req.session.userId
    let user = null

    if (isLoggedIn) {
      user = await User.findOne({ id: this.req.session.userId })
    }

    return {
      page: 'cli/authorize',
      props: {
        code,
        isLoggedIn,
        user: user ? { email: user.email, fullName: user.fullName } : null,
        status: null
      }
    }
  }
}
