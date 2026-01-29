module.exports = {
  friendlyName: 'Delete environment',

  description: 'Delete an environment and all its resources.',

  inputs: {
    projectSlug: {
      type: 'string',
      required: true,
      description: 'Project slug'
    },
    slug: {
      type: 'string',
      required: true,
      description: 'Environment slug'
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

  fn: async function ({ projectSlug, slug }) {
    const user = await User.findOne({ id: this.req.session.userId })

    const project = await Project.findOne({ slug: projectSlug }).populate('team')

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

    const environment = await Environment.findOne({ project: project.id, slug })

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
