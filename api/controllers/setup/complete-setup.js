const establishSession = require('../../lib/establish-session')

const hasSpecialCharacter = (value) =>
  /[`!@#$%^&*()_+\-=[\]{};':"\\|,.<>/?~]/.test(value)

module.exports = {
  friendlyName: 'Complete setup',

  description:
    'Create the genesis user and default team to complete Slipway setup.',

  inputs: {
    setupToken: { type: 'string', maxLength: 256 },
    email: {
      type: 'string',
      isEmail: true,
      required: true,
      description: 'Email address for the genesis user'
    },
    password: {
      type: 'string',
      required: true,
      minLength: 8,
      description: 'Password for the genesis user'
    },
    confirmPassword: {
      type: 'string',
      required: true,
      description: 'Password confirmation for the genesis user'
    }
  },

  exits: {
    badRequest: {
      responseType: 'badRequest',
      description: 'Invalid setup data provided.'
    },
    success: {
      responseType: 'redirect'
    },
    precognitionSuccess: {
      responseType: 'precognitionSuccess'
    }
  },

  fn: async function ({
    email: userEmail,
    password,
    confirmPassword,
    setupToken
  }) {
    if (
      sails.inertia.shouldValidate('password', this.req) &&
      !hasSpecialCharacter(password)
    ) {
      throw {
        badRequest: {
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
        badRequest: {
          problems: [
            { confirmPassword: 'Password confirmation does not match.' }
          ]
        }
      }
    }

    if (sails.inertia.isPrecognitive(this.req)) {
      throw 'precognitionSuccess'
    }

    const crypto = require('node:crypto')
    const expected = sails.config.custom.setupToken
    const digest = (value) =>
      crypto
        .createHash('sha256')
        .update(value || '')
        .digest()
    if (
      !expected ||
      !crypto.timingSafeEqual(digest(setupToken), digest(expected))
    ) {
      throw {
        badRequest: {
          problems: [
            {
              setupToken: 'Enter the installation claim token from your server.'
            }
          ]
        }
      }
    }

    const email = userEmail.toLowerCase()

    // Derive display name from email (part before @)
    const fullName = email
      .split('@')[0]
      .replace(/[._-]/g, ' ')
      .replace(/\b\w/g, (c) => c.toUpperCase())

    // Auto-generate team name
    const teamName = `${fullName}'s Team`

    let genesisUser
    let defaultTeam

    try {
      await require('../../lib/with-datastore-transaction')(async (db) => {
        // The unique setting and all founder records commit or roll back together.
        await Setting.create({
          key: 'installationCompleted',
          value: 'true'
        }).usingConnection(db)
        // Create the genesis user
        genesisUser = await User.create({
          fullName,
          email,
          password,
          emailStatus: 'verified', // Genesis user is auto-verified
          isGenesisUser: true,
          teamRole: 'owner'
        })
          .usingConnection(db)
          .fetch()

        // Create the default team owned by genesis user
        defaultTeam = await Team.create({
          name: teamName,
          owner: genesisUser.id
        })
          .usingConnection(db)
          .fetch()

        // Update user with their team
        await User.updateOne({ id: genesisUser.id })
          .set({
            team: defaultTeam.id
          })
          .usingConnection(db)
      })
    } catch (error) {
      if (error.code === 'E_UNIQUE') {
        throw {
          badRequest: {
            problems: [
              {
                setup:
                  'Setup has already completed, or this account already exists. Refresh to continue.'
              }
            ]
          }
        }
      }

      sails.log.error('Setup error:', error)
      throw {
        badRequest: {
          problems: [
            { setup: 'Something went wrong during setup. Please try again.' }
          ]
        }
      }
    }

    // Update the setup status so the policy blocks future access
    sails.config.custom.slipwayIsSetup = true
    delete sails.config.custom.setupToken

    // Log in the genesis user
    await establishSession(this.req, genesisUser)

    sails.log.info(
      `Slipway setup complete. Genesis user: ${genesisUser.email}, Team: ${defaultTeam.name}`
    )

    return '/'
  }
}
