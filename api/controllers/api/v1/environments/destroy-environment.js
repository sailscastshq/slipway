module.exports = {
  friendlyName: 'Delete environment',

  description: 'Delete an environment and all its resources.',

  inputs: {
    projectId: {
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

  fn: async function ({ projectId, id }) {
    const user = await User.findOne({ id: this.req.session.userId })

    // Find project
    let project = await Project.findOne({ id: projectId }).populate('team')
    if (!project) {
      project = await Project.findOne({ slug: projectId }).populate('team')
    }

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

    // Find environment
    let environment = await Environment.findOne({ id, project: project.id })
    if (!environment) {
      environment = await Environment.findOne({ slug: id, project: project.id })
    }

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
