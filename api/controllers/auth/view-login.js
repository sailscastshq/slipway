module.exports = {
  friendlyName: 'View login',

  description: 'Display "Login" page.',

  inputs: {
    redirect: {
      type: 'string',
      description: 'URL to redirect to after successful login.'
    },
    error: {
      type: 'string',
      description: 'Error code to display.'
    }
  },

  exits: {
    success: {
      responseType: 'inertia'
    }
  },

  fn: async function ({ redirect, error }) {
    // Map error codes to user-friendly messages
    const errorMessages = {
      invalid_cli_code: 'The CLI authorization code is invalid or has expired.'
    }

    return {
      page: 'auth/login',
      redirect: redirect || null,
      error: error ? errorMessages[error] || error : null
    }
  }
}
