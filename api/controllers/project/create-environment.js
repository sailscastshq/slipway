module.exports = {
  friendlyName: 'Create environment',

  description: 'Create a new environment for a project from the web UI.',

  inputs: {
    slug: {
      type: 'string',
      required: true,
      description: 'Project slug'
    },
    name: {
      type: 'string',
      required: true,
      description: 'Environment name'
    }
  },

  exits: {
    success: {
      responseType: 'redirect'
    },
    notFound: {
      responseType: 'redirect'
    }
  },

  fn: async function ({ slug, name }) {
    const user = await User.findOne({ id: this.req.session.userId }).populate('team')

    const project = await Project.findOne({ slug, team: user.team.id })

    if (!project) {
      throw { notFound: '/' }
    }

    const { telemetryToken, telemetryTokenHash } = sails.helpers.environment.generateTelemetryToken()
    await Environment.create({
      name,
      telemetryToken,
      telemetryTokenHash,
      project: project.id
    })

    return `/projects/${slug}`
  }
}
