module.exports = {
  friendlyName: 'View team members',

  description: 'Display team members management page.',

  inputs: {},

  exits: {
    success: {
      responseType: 'inertia'
    }
  },

  fn: async function () {
    const user = await User.forRequest(this.req, { populateTeam: true })

    const memberships = await TeamMembership.find({ team: user.team.id })
      .populate('user')
      .sort('createdAt ASC')
    const members = memberships
      .filter((membership) => membership.user)
      .map((membership) => ({
        ...membership.user,
        teamRole: membership.role,
        membershipStatus: membership.status
      }))

    return {
      page: 'settings/team',
      props: {
        team: {
          id: user.team.id,
          name: user.team.name,
          slug: user.team.slug
        },
        members: members.map((m) => ({
          id: m.id,
          fullName: m.fullName,
          email: m.email,
          initials: m.initials,
          teamRole: m.teamRole,
          emailStatus: m.emailStatus,
          membershipStatus: m.membershipStatus,
          createdAt: m.createdAt
        })),
        currentUserRole: user.teamRole
      }
    }
  }
}
