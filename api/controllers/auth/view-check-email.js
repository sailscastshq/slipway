module.exports = {
  friendlyName: 'View verify email',

  description: 'Display "Verify email" page.',

  exits: {
    success: {
      responseType: 'inertia'
    }
  },

  fn: async function () {
    const resendCooldownDurationMs = sails.config.custom.emailLinkResendCooldown
    const resendAvailableAt = this.req.session.emailLinkResendAvailableAt || 0
    const resendCooldownSecondsRemaining = Math.max(
      0,
      Math.ceil((resendAvailableAt - Date.now()) / 1000)
    )

    return {
      page: 'auth/check-email',
      props: {
        message:
          'We sent the next step to your email. Open the message and follow the link to continue.',
        resendCooldownSecondsRemaining,
        resendCooldownDurationSeconds: Math.ceil(
          resendCooldownDurationMs / 1000
        )
      }
    }
  }
}
