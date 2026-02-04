module.exports = {
  friendlyName: 'Delete service',

  description: 'Delete a service and its Docker container.',

  inputs: {
    id: {
      type: 'string',
      required: true,
      description: 'Service ID'
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
    }
  },

  fn: async function ({ id }) {
    const user = await User.findOne({ id: this.req.session.userId })

    const service = await Service.findOne(id)
      .populate('environment')

    if (!service) {
      throw 'notFound'
    }

    // Get project to check access
    const environment = await Environment.findOne({ id: service.environment.id })
      .populate('project')

    const project = await Project.findOne({ id: environment.project.id })
      .populate('team')

    if (project.team.id !== user.team) {
      throw 'forbidden'
    }

    // Only owner/admin can delete services
    if (user.teamRole !== 'owner' && user.teamRole !== 'admin') {
      throw 'forbidden'
    }

    // Stop and remove Docker container
    try {
      await sails.helpers.docker.destroyService(service.id)
    } catch (err) {
      sails.log.warn(`Failed to destroy service container: ${err.message}`)
    }

    sails.log.info(`Service ${service.name} deleted from ${project.slug}/${environment.slug}`)

    await Service.destroyOne({ id: service.id })

    return { message: 'Service deleted successfully' }
  }
}
