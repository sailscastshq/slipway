module.exports = {
  friendlyName: 'Update project',

  description: 'Update a project\'s details.',

  inputs: {
    id: {
      type: 'string',
      required: true,
      description: 'Project ID or slug'
    },
    name: {
      type: 'string',
      maxLength: 120,
      description: 'Human-readable project name'
    },
    description: {
      type: 'string',
      maxLength: 500,
      description: 'Project description'
    },
    repositoryUrl: {
      type: 'string',
      description: 'Git repository URL'
    },
    dockerfilePath: {
      type: 'string',
      description: 'Path to Dockerfile relative to repo root'
    }
  },

  exits: {
    success: {
      statusCode: 200
    },
    notFound: {
      statusCode: 404,
      description: 'Project not found'
    },
    forbidden: {
      statusCode: 403,
      description: 'Not authorized to update this project'
    },
    badRequest: {
      responseType: 'badRequest'
    }
  },

  fn: async function ({ id, name, description, repositoryUrl, dockerfilePath }) {
    const user = await User.findOne({ id: this.req.session.userId })

    // Find the project
    let project = await Project.findOne(id).populate('team')
    if (!project) {
      project = await Project.findOne({ slug: id }).populate('team')
    }

    if (!project) {
      throw 'notFound'
    }

    // Check user has access
    if (project.team.id !== user.team) {
      throw 'forbidden'
    }

    // Build update object with only provided fields
    const updates = {}
    if (name !== undefined) updates.name = name
    if (description !== undefined) updates.description = description
    if (repositoryUrl !== undefined) updates.repositoryUrl = repositoryUrl
    if (dockerfilePath !== undefined) updates.dockerfilePath = dockerfilePath

    try {
      await Project.updateOne({ id: project.id }).set(updates)
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

    const updatedProject = await Project.findOne({ id: project.id })
      .populate('environments')
      .populate('createdBy')

    return { project: updatedProject }
  }
}
