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
    const user = await User.findOne({ id: this.req.session.userId }).populate(
      'team'
    )

    const members = await User.find({ team: user.team.id }).sort(
      'createdAt ASC'
    )

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
          createdAt: m.createdAt
        })),
        currentUserRole: user.teamRole
      }
    }
  }
}
