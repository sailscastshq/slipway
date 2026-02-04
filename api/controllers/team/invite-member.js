const crypto = require('crypto')

module.exports = {
  friendlyName: 'Invite member',

  description: 'Add a new member to the team by email.',

  inputs: {
    email: {
      type: 'string',
      required: true,
      isEmail: true,
      description: 'Email of the person to invite'
    },
    role: {
      type: 'string',
      isIn: ['admin', 'member'],
      defaultsTo: 'member',
      description: 'Role for the new member'
    }
  },

  exits: {
    success: {
      responseType: 'redirect'
    },
    conflict: {
      statusCode: 409
    }
  },

  fn: async function ({ email, role }) {
    const currentUser = await User.findOne({ id: this.req.session.userId })

    // Only owners and admins can invite
    if (!['owner', 'admin'].includes(currentUser.teamRole)) {
      throw { redirect: '/settings/team' }
    }

    // Check if user already exists
    const existingUser = await User.findOne({ email: email.toLowerCase() })

    if (existingUser) {
      if (existingUser.team === currentUser.team) {
        // Already on this team
        this.req.addFlash('error', `${email} is already a member of this team.`)
        return '/settings/team'
      }
      // User exists but on another team — for 0.0.1, don't support multi-team
      this.req.addFlash('error', `${email} already has an account on another team.`)
      return '/settings/team'
    }

    // Create new user account (no password — they'll use Forgot Password to set one)
    const tempPassword = crypto.randomBytes(32).toString('hex')

    await User.create({
      email: email.toLowerCase(),
      fullName: email.split('@')[0].replace(/[._-]/g, ' ').replace(/\b\w/g, c => c.toUpperCase()),
      password: tempPassword,
      emailStatus: 'unverified',
      teamRole: role,
      team: currentUser.team
    })

    this.req.addFlash('success', `Invited ${email}. They can sign in using Forgot Password to set up their account.`)
    return '/settings/team'
  }
}
