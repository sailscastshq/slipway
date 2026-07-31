module.exports = {
  friendlyName: 'Forgot password',

  description:
    'Send a password recovery notification to the user with the specified email address.',

  inputs: {
    email: {
      description:
        'The email address of the alleged user who wants to recover their password.',
      example: 'kelvin@boringstack.com',
      type: 'string',
      required: true,
      isEmail: true
    }
  },

  exits: {
    success: {
      description:
        'The email address might have matched a user in the database.  (If so, a recovery email was sent.)',
      responseType: 'redirect'
    },
    precognitionSuccess: {
      responseType: 'precognitionSuccess'
    }
  },

  fn: async function ({ email }) {
    if (sails.inertia.isPrecognitive(this.req)) {
      throw 'precognitionSuccess'
    }

    const normalizedEmail = email.toLowerCase()
    const token = await sails.helpers.strings.random('url-friendly')
    const now = Date.now()

    const user = await User.updateOne({ email: normalizedEmail }).set({
      passwordResetToken: token,
      passwordResetTokenExpiresAt:
        now + sails.config.custom.passwordResetTokenTTL
    })

    if (!user) {
      return '/check-email'
    }

    await sails.helpers.mail.sendConfigured.with({
      to: user.email,
      subject: 'Password reset instructions',
      template: 'reset-password',
      templateData: {
        fullName: user.fullName,
        token
      }
    })

    this.req.session.userEmail = user.email
    this.req.session.emailLinkResendAvailableAt =
      now + sails.config.custom.emailLinkResendCooldown
    return '/check-email'
  }
}
