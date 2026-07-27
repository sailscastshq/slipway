module.exports = {
  friendlyName: 'Build Bridge actor',

  description:
    'Build the small, serializable actor context passed to target app authorization helpers.',

  inputs: {
    user: {
      type: 'ref',
      required: true
    },
    project: {
      type: 'ref',
      required: true
    },
    environment: {
      type: 'ref',
      required: true
    }
  },

  exits: {
    success: {
      outputType: 'ref'
    }
  },

  fn: async function ({ user, project, environment }) {
    const teamId =
      user.team && typeof user.team === 'object' ? user.team.id : user.team

    return {
      id: String(user.id),
      email: user.email,
      fullName: user.fullName,
      role: user.teamRole || 'member',
      teamId: String(teamId),
      projectId: String(project.id),
      projectSlug: project.slug,
      environmentId: String(environment.id),
      environmentSlug: environment.slug
    }
  }
}
