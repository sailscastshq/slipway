module.exports = {
  friendlyName: 'Resend link',

  description: '',

  inputs: {},

  exits: {
    success: {
      responseType: 'redirect'
    },
    userNotFound: {
      responseType: 'notFound'
    }
  },

  fn: async function () {
    const now = Date.now()
    const resendAvailableAt = this.req.session.emailLinkResendAvailableAt || 0
    let user

    if (this.req.session.userId) {
      user = await User.findOne({ id: this.req.session.userId })
    } else if (this.req.session.userEmail) {
      user = await User.findOne({ email: this.req.session.userEmail })
    }

    if (!user) {
      return '/check-email'
    }

    if (resendAvailableAt > now) {
      const remainingSeconds = Math.ceil((resendAvailableAt - now) / 1000)

      sails.inertia.flash(
        'error',
        `Please wait ${remainingSeconds}s before requesting another link.`
      )

      return '/check-email'
    }

    const token = await sails.helpers.strings.random('url-friendly')
    const setResendCooldown = () => {
      this.req.session.emailLinkResendAvailableAt =
        now + sails.config.custom.emailLinkResendCooldown
    }

    if (user.emailStatus === 'unverified') {
      await User.updateOne({ id: user.id }).set({
        emailProofToken: token,
        emailProofTokenExpiresAt: now + sails.config.custom.emailProofTokenTTL
      })

      await sails.helpers.mail.sendConfigured.with({
        subject: 'Verify your email',
        template: 'verify-account',
        to: user.email,
        templateData: {
          token,
          fullName: user.fullName
        }
      })

      setResendCooldown()
      sails.inertia.flash('success', 'We sent you a new link.')

      return '/check-email'
    }

    if (user.emailStatus === 'change-requested') {
      if (!user.emailChangeCandidate) {
        return this.req.session.userId ? '/' : '/check-email'
      }

      await User.updateOne({ id: user.id }).set({
        emailProofToken: token,
        emailProofTokenExpiresAt: now + sails.config.custom.emailProofTokenTTL
      })

      await sails.helpers.mail.sendConfigured.with({
        subject: 'Confirm your new email address',
        template: 'verify-new-email',
        to: user.emailChangeCandidate,
        templateData: {
          token,
          fullName: user.fullName
        }
      })

      setResendCooldown()
      sails.inertia.flash('success', 'We sent you a new link.')

      return '/check-email'
    }

    if (this.req.session.userId) {
      return '/'
    }

    await User.updateOne({ id: user.id }).set({
      passwordResetToken: token,
      passwordResetTokenExpiresAt:
        now + sails.config.custom.passwordResetTokenTTL
    })

    await sails.helpers.mail.sendConfigured.with({
      to: user.email,
      subject: 'Password reset instructions',
      template: 'reset-password',
      templateData: {
        fullName: user.fullName,
        token
      }
    })

    setResendCooldown()
    sails.inertia.flash('success', 'We sent you a new link.')

    return '/check-email'
  }
}
