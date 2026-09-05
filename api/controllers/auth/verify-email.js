const establishSession = require('../../lib/establish-session')

module.exports = {
  friendlyName: 'Verify email',

  description: `Confirm a new user's email address, or an existing user's request for an email address change,
  then redirect to either a special landing page (for newly-signed up users), or the account page
  (for existing users who just changed their email address).`,

  inputs: {
    token: {
      description: 'The verification token from the email.',
      example: 'lyCap0N9i8wKYz7rhrEPog'
    }
  },

  exits: {
    success: {
      description:
        'Email address confirmed and requesting user logged in.  Since this looks like a browser, redirecting...',
      responseType: 'redirect'
    },
    invalidOrExpiredToken: {
      responseType: 'expired',
      description: 'The provided token is expired, invalid, or already used up.'
    },
    emailAlreadyInUse: {
      statusCode: 409,
      description: 'The requested email address is no longer available.'
    }
  },

  fn: async function ({ token }) {
    if (!token) {
      throw 'invalidOrExpiredToken'
    }

    const user = await User.findOne({ emailProofToken: token })

    if (!user || user.emailProofTokenExpiresAt <= Date.now()) {
      throw 'invalidOrExpiredToken'
    }

    const criteria = {
      id: user.id,
      emailProofToken: token,
      emailProofTokenExpiresAt: { '>': Date.now() },
      authVersion: user.authVersion || ''
    }
    if (user.emailStatus == 'unverified') {
      const updated = await User.updateOne(criteria).set({
        emailStatus: 'verified',
        emailProofToken: '',
        emailProofTokenExpiresAt: 0
      })

      if (!updated) throw 'invalidOrExpiredToken'
      await establishSession(this.req, updated)
      delete this.req.session.userEmail

      return '/verify-email/success'
    } else if (user.emailStatus == 'change-requested') {
      if (!user.emailChangeCandidate) {
        throw new Error(
          `Consistency violation: Could not update user because this user record's emailChangeCandidate ("${user.emailChangeCandidate}") is missing.  (This should never happen.)`
        )
      }

      const email = user.emailChangeCandidate.trim().toLowerCase()
      if ((await User.count({ email, id: { '!=': user.id } })) > 0) {
        throw {
          emailAlreadyInUse: {
            message:
              'This email address is no longer available. Sign in and request another address from your profile.'
          }
        }
      }

      const updated = await User.updateOne(criteria)
        .set({
          emailStatus: 'verified',
          authVersion: require('node:crypto').randomUUID(),
          passwordResetToken: '',
          passwordResetTokenExpiresAt: 0,
          emailProofToken: '',
          emailProofTokenExpiresAt: 0,
          email,
          emailChangeCandidate: ''
        })
        .intercept('E_UNIQUE', () => ({
          emailAlreadyInUse: {
            message:
              'This email address is no longer available. Request another address from your profile.'
          }
        }))
      if (!updated) throw 'invalidOrExpiredToken'
      sails.sse?.revoke?.({ userId: user.id })
      await CliToken.destroy({ user: user.id })
      await establishSession(this.req, updated)
      return '/'
    } else {
      throw new Error(
        `Consistency violation: User ${user.id} has an email proof token, but somehow also has an emailStatus of "${user.emailStatus}"!  (This should never happen.)`
      )
    }
  }
}
