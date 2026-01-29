module.exports = {
  friendlyName: 'Delete project',

  description: 'Delete a project and all its environments.',

  inputs: {
    id: {
      type: 'string',
      required: true,
      description: 'Project ID or slug'
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
      description: 'Not authorized to delete this project'
    }
  },

  fn: async function ({ id }) {
    const user = await User.findOne({ id: this.req.session.userId })

    // Find the project
    let project = await Project.findOne(id).populate('team').populate('environments')
    if (!project) {
      project = await Project.findOne({ slug: id }).populate('team').populate('environments')
    }

    if (!project) {
      throw 'notFound'
    }

    // Check user has access and is owner/admin
    if (project.team.id !== user.team) {
      throw 'forbidden'
    }

    if (user.teamRole !== 'owner' && user.teamRole !== 'admin') {
      throw 'forbidden'
    }

    // Delete all environments and their associated resources
    for (const env of project.environments) {
      // Delete apps, services, and deployments for each environment
      await App.destroy({ environment: env.id })
      await Service.destroy({ environment: env.id })
      await Deployment.destroy({ environment: env.id })
      await Environment.destroyOne({ id: env.id })
    }

    // Delete the project
    await Project.destroyOne({ id: project.id })

    return { message: 'Project deleted successfully' }
  }
}
