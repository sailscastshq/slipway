const establishSession = require('../../lib/establish-session')

const hasSpecialCharacter = (value) =>
  /[`!@#$%^&*()_+\-=[\]{};':"\\|,.<>/?~]/.test(value)

module.exports = {
  friendlyName: 'Reset password',

  description: '',

  inputs: {
    token: {
      description: 'The verification token from the email.',
      example: 'lyCap0N9i8wKYz7rhrEPog'
    },
    password: {
      type: 'string',
      required: true,
      minLength: 8
    },
    confirmPassword: {
      type: 'string',
      required: true
    }
  },

  exits: {
    success: {
      responseType: 'redirect'
    },
    invalidOrExpiredToken: {
      responseType: 'expired',
      description: 'The provided token is expired, invalid, or already used up.'
    },
    badSignupRequest: {
      responseType: 'badRequest',
      description:
        'The provided fullName, password and/or email address are invalid.',
      extendedDescription:
        'If this request was sent from a graphical user interface, the request ' +
        'parameters should have been validated/coerced _before_ they were sent.'
    },
    precognitionSuccess: {
      responseType: 'precognitionSuccess'
    }
  },

  fn: async function ({ token, password, confirmPassword }) {
    if (
      sails.inertia.shouldValidate('password', this.req) &&
      !hasSpecialCharacter(password)
    ) {
      throw {
        badSignupRequest: {
          problems: [
            {
              password: 'Password must include at least one special character.'
            }
          ]
        }
      }
    }

    if (
      sails.inertia.shouldValidate('confirmPassword', this.req) &&
      password !== confirmPassword
    ) {
      throw {
        badSignupRequest: {
          problems: [
            { confirmPassword: 'Password confirmation does not match.' }
          ]
        }
      }
    }

    if (sails.inertia.isPrecognitive(this.req)) {
      throw 'precognitionSuccess'
    }

    if (!token) {
      throw 'invalidOrExpiredToken'
    }

    const user = await User.findOne({ passwordResetToken: token })

    if (!user || user.passwordResetTokenExpiresAt <= Date.now()) {
      throw 'invalidOrExpiredToken'
    }
    const updated = await User.updateOne({
      id: user.id,
      passwordResetToken: token,
      passwordResetTokenExpiresAt: { '>': Date.now() }
    }).set({
      password,
      passwordResetToken: '',
      passwordResetTokenExpiresAt: 0,
      emailProofToken: '',
      emailProofTokenExpiresAt: 0,
      emailChangeCandidate: '',
      emailStatus: 'verified'
    })

    if (!updated) throw 'invalidOrExpiredToken'
    sails.sse?.revoke?.({ userId: user.id })
    await CliToken.destroy({ user: user.id })
    await establishSession(this.req, updated)

    return '/reset-password/success'
  }
}
