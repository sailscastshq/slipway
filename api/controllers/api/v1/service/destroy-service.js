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

    const service = await Service.findOne(id).populate('environment')

    if (!service) {
      throw 'notFound'
    }

    // Get project to check access
    const environment = await Environment.findOne({
      id: service.environment.id
    })
      .populate('project')
      .decrypt()

    const project = await Project.findOne({
      id: environment.project.id
    }).populate('team')

    if (project.team.id !== user.team) {
      throw 'forbidden'
    }

    // Only owner/admin can delete services
    if (user.teamRole !== 'owner' && user.teamRole !== 'admin') {
      throw 'forbidden'
    }

    // Remove auto-managed env var
    if (service.envVarKey) {
      const currentVars = environment.envVars || {}
      const { [service.envVarKey]: _, ...remainingVars } = currentVars
      await Environment.updateOne({ id: environment.id }).set({
        envVars: remainingVars
      })
    }

    // Stop and remove Docker container
    try {
      await sails.helpers.docker.destroyService(service.id)
    } catch (err) {
      sails.log.warn(`Failed to destroy service container: ${err.message}`)
    }

    sails.log.info(
      `Service ${service.name} deleted from ${project.slug}/${environment.slug}`
    )

    // Audit log
    await sails.helpers.audit.log.with({
      action: 'service.destroyed',
      resourceType: 'service',
      resourceId: service.id,
      details: {
        name: service.name,
        type: service.type,
        projectSlug: project.slug
      },
      userId: user.id,
      teamId: project.team.id,
      ipAddress: this.req.ip
    })

    await Service.destroyOne({ id: service.id })

    return { message: 'Service deleted successfully' }
  }
}
