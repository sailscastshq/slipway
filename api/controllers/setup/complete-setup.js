module.exports = {
  friendlyName: 'Complete setup',

  description: 'Create the genesis user and default team to complete Slipway setup.',

  inputs: {
    fullName: {
      type: 'string',
      maxLength: 120,
      required: true,
      description: 'Full name of the genesis user'
    },
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
    teamName: {
      type: 'string',
      required: true,
      maxLength: 120,
      description: 'Name for the default team'
    }
  },

  exits: {
    badRequest: {
      responseType: 'badRequest',
      description: 'Invalid setup data provided.'
    },
    success: {
      responseType: 'redirect'
    }
  },

  fn: async function ({ fullName, email: userEmail, password, teamName }) {
    const email = userEmail.toLowerCase()

    // Double-check that setup hasn't already been completed
    const existingGenesisUser = await User.findOne({ isGenesisUser: true })
    if (existingGenesisUser) {
      throw {
        badRequest: {
          problems: [{ setup: 'Slipway has already been configured.' }]
        }
      }
    }

    let genesisUser
    let defaultTeam

    try {
      // Create the genesis user
      genesisUser = await User.create({
        fullName,
        email,
        password,
        emailStatus: 'verified', // Genesis user is auto-verified
        isGenesisUser: true,
        teamRole: 'owner'
      }).fetch()

      // Create the default team owned by genesis user
      defaultTeam = await Team.create({
        name: teamName,
        owner: genesisUser.id
      }).fetch()

      // Update user with their team
      await User.updateOne({ id: genesisUser.id }).set({
        team: defaultTeam.id
      })
    } catch (error) {
      // Clean up if something went wrong
      if (genesisUser) {
        await User.destroyOne({ id: genesisUser.id })
      }
      if (defaultTeam) {
        await Team.destroyOne({ id: defaultTeam.id })
      }

      if (error.code === 'E_UNIQUE') {
        throw {
          badRequest: {
            problems: [{ email: 'An account with this email address already exists.' }]
          }
        }
      }

      throw {
        badRequest: {
          problems: [{ setup: 'Something went wrong during setup. Please try again.' }]
        }
      }
    }

    // Update the setup status so the policy blocks future access
    sails.config.custom.slipwayIsSetup = true

    // Log in the genesis user
    this.req.session.userId = genesisUser.id

    sails.log.info(`Slipway setup complete. Genesis user: ${genesisUser.email}, Team: ${defaultTeam.name}`)

    return '/dashboard'
  }
}
