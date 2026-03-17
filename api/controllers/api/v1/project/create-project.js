module.exports = {
  friendlyName: 'Create project',

  description: "Create a new project within the user's team.",

  inputs: {
    name: {
      type: 'string',
      required: true,
      maxLength: 120,
      description: 'Human-readable project name'
    },
    description: {
      type: 'string',
      maxLength: 500,
      description: 'Optional project description'
    },
    repositoryUrl: {
      type: 'string',
      description: 'Git repository URL'
    },
    dockerfilePath: {
      type: 'string',
      defaultsTo: 'Dockerfile',
      description: 'Path to Dockerfile relative to repo root'
    }
  },

  exits: {
    success: {
      statusCode: 201
    },
    badRequest: {
      responseType: 'badRequest'
    }
  },

  fn: async function ({ name, description, repositoryUrl, dockerfilePath }) {
    const user = await User.findOne({ id: this.req.session.userId })

    if (!user.team) {
      throw {
        badRequest: {
          problems: [{ team: 'You must belong to a team to create projects.' }]
        }
      }
    }

    let project
    try {
      project = await Project.create({
        name,
        description,
        repositoryUrl,
        dockerfilePath,
        team: user.team,
        createdBy: user.id
      }).fetch()

      // Create default production environment
      const { telemetryToken, telemetryTokenHash } =
        sails.helpers.environment.generateTelemetryToken()
      await Environment.create({
        name: 'Production',
        slug: 'production',
        isProduction: true,
        telemetryToken,
        telemetryTokenHash,
        project: project.id
      })
    } catch (error) {
      if (error.code === 'E_UNIQUE') {
        throw {
          badRequest: {
            problems: [{ slug: 'A project with this name already exists.' }]
          }
        }
      }
      throw error
    }

    // Fetch with environments populated
    const fullProject = await Project.findOne({ id: project.id })
      .populate('environments')
      .populate('createdBy')

    return { project: fullProject }
  }
}
