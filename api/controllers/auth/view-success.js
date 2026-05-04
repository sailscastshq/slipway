module.exports = {
  friendlyName: 'View success email',

  description: 'Display "Success" page.',
  inputs: {
    operation: {
      isIn: ['verify-email', 'check-email', 'reset-password']
    }
  },
  exits: {
    success: {
      responseType: 'inertia'
    }
  },

  fn: async function ({ operation }) {
    const copy = {
      'verify-email': {
        pageTitle: 'Email verified',
        pageHeading: 'Email verified',
        message: 'Your email is confirmed. You can continue to Slipway.'
      },
      'check-email': {
        pageTitle: 'Check your inbox',
        pageHeading: 'Check your inbox',
        message: 'We sent the link you need to continue.'
      },
      'reset-password': {
        pageTitle: 'Password updated',
        pageHeading: 'Password updated',
        message:
          'Your new password is saved. You are signed in and ready to continue.'
      }
    }[operation]

    return {
      page: 'auth/success',
      props: {
        pageTitle: copy.pageTitle,
        pageHeading: copy.pageHeading,
        message: copy.message
      }
    }
  }
}
