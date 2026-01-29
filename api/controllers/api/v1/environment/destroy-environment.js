module.exports = {
  friendlyName: 'Delete environment',

  description: 'Delete an environment and all its resources.',

  inputs: {
    projectIdOrSlug: {
      type: 'string',
      required: true,
      description: 'Project ID or slug'
    },
    id: {
      type: 'string',
      required: true,
      description: 'Environment ID or slug'
    }
  },

  exits: {
    success: {
      statusCode: 200
    },
    notFound: {
      statusCode: 404
    },
    forbidden: {
      statusCode: 403
    },
    badRequest: {
      responseType: 'badRequest'
    }
  },

  fn: async function ({ projectIdOrSlug, id }) {
    const user = await User.findOne({ id: this.req.session.userId })

    // Find project by ID or slug
    const project = await Project.findOne({
      or: [{ id: projectIdOrSlug }, { slug: projectIdOrSlug }]
    }).populate('team')

    if (!project) {
      throw 'notFound'
    }

    if (project.team.id !== user.team) {
      throw 'forbidden'
    }

    // Only owner/admin can delete environments
    if (user.teamRole !== 'owner' && user.teamRole !== 'admin') {
      throw 'forbidden'
    }

    // Find environment by ID or slug
    const environment = await Environment.findOne({
      project: project.id,
      or: [{ id }, { slug: id }]
    })

    if (!environment) {
      throw 'notFound'
    }

    // Prevent deleting production environment if it's the only one
    if (environment.isProduction) {
      const envCount = await Environment.count({ project: project.id })
      if (envCount === 1) {
        throw {
          badRequest: {
            problems: [{ environment: 'Cannot delete the only production environment.' }]
          }
        }
      }
    }

    // Delete associated resources
    // TODO: Stop running containers before deleting
    await App.destroy({ environment: environment.id })
    await Service.destroy({ environment: environment.id })
    await Deployment.destroy({ environment: environment.id })
    await Environment.destroyOne({ id: environment.id })

    return { message: 'Environment deleted successfully' }
  }
}
