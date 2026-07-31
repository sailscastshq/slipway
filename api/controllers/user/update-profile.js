const hasSpecialCharacter = (value) =>
  /[`!@#$%^&*()_+\-=[\]{};':"\\|,.<>/?~]/.test(value)

module.exports = {
  friendlyName: 'Update profile',

  description: 'Update the profile information of the logged-in user.',

  inputs: {
    fullName: {
      type: 'string',
      required: true,
      description: 'The full name of the user.'
    },
    email: {
      type: 'string',
      required: true,
      isEmail: true,
      description: 'The email address of the user.'
    },
    currentPassword: {
      type: 'string',
      description: 'The current password of the user.',
      allowNull: true
    },
    password: {
      type: 'string',
      allowNull: true,
      minLength: 8,
      description: 'The new password of the user.'
    },
    confirmPassword: {
      type: 'string',
      description: 'The confirmation of the new password.',
      allowNull: true
    }
  },

  exits: {
    success: {
      responseType: 'inertiaRedirect',
      description: 'Profile updated successfully.'
    },
    invalid: {
      responseType: 'badRequest',
      description: 'The provided inputs are invalid.'
    },
    unauthorized: {
      responseType: 'inertiaRedirect',
      description: 'The provided current password is incorrect.'
    },
    precognitionSuccess: {
      responseType: 'precognitionSuccess'
    }
  },

  fn: async function ({
    fullName,
    email,
    currentPassword,
    password,
    confirmPassword
  }) {
    if (
      password &&
      sails.inertia.shouldValidate('password', this.req) &&
      !hasSpecialCharacter(password)
    ) {
      throw {
        invalid: {
          problems: [
            {
              password: 'Password must include at least one special character.'
            }
          ]
        }
      }
    }

    if (
      password &&
      sails.inertia.shouldValidate('currentPassword', this.req) &&
      !currentPassword
    ) {
      throw {
        invalid: {
          problems: [{ currentPassword: 'Current password is required.' }]
        }
      }
    }

    if (
      password &&
      sails.inertia.shouldValidate('confirmPassword', this.req) &&
      password !== confirmPassword
    ) {
      throw {
        invalid: {
          problems: [
            { confirmPassword: 'Password confirmation does not match.' }
          ]
        }
      }
    }

    if (sails.inertia.isPrecognitive(this.req)) {
      throw 'precognitionSuccess'
    }

    const userId = this.req.session.userId
    const user = await User.findOne({ id: userId }).select([
      'password',
      'email'
    ])

    if (currentPassword) {
      await sails.helpers.passwords
        .checkPassword(currentPassword, user.password)
        .intercept('incorrect', () => {
          delete this.req.session.userId
          return { unauthorized: '/login' }
        })
    }

    const updatedData = {
      fullName
    }
    if (email !== user.email) {
      updatedData.emailChangeCandidate = email
      updatedData.emailStatus = 'change-requested'
      const emailProofToken = await sails.helpers.strings.random('url-friendly')
      updatedData.emailProofToken = emailProofToken
      updatedData.emailProofTokenExpiresAt =
        Date.now() + sails.config.custom.emailProofTokenTTL

      await sails.helpers.mail.sendConfigured.with({
        to: email,
        subject: 'Confirm your new email address',
        template: 'verify-new-email',
        templateData: {
          fullName,
          token: emailProofToken
        }
      })
    }

    if (password) {
      updatedData.password = password
    }

    await User.updateOne({ id: userId }).set(updatedData)

    // Refresh the cached loggedInUser data so the UI shows updated info
    sails.inertia.refreshOnce('loggedInUser')
    sails.inertia.flash('success', 'Profile updated.')
    return 'back'
  }
}
