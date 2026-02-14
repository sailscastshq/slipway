module.exports = {
  friendlyName: 'Update service',

  description: 'Update service display name.',

  inputs: {
    serviceId: {
      type: 'string',
      required: true,
      description: 'Service ID'
    },
    name: {
      type: 'string',
      required: true,
      description: 'New display name for the service'
    }
  },

  exits: {
    success: {
      statusCode: 200
    },
    notFound: {
      statusCode: 404
    },
    badRequest: {
      statusCode: 400
    }
  },

  fn: async function ({ serviceId, name }) {
    const user = await User.findOne({ id: this.req.session.userId }).populate('team')

    const service = await Service.findOne({ id: serviceId }).populate('environment')
    if (!service) throw 'notFound'

    const environment = await Environment.findOne({ id: service.environment.id }).populate('project')
    if (!environment) throw 'notFound'

    const project = await Project.findOne({ id: environment.project.id })
    if (!project || project.team !== user.team.id) throw 'notFound'

    // Validate name
    const trimmedName = name.trim()
    if (!trimmedName) {
      throw { badRequest: { message: 'Name cannot be empty' } }
    }

    if (trimmedName.length > 50) {
      throw { badRequest: { message: 'Name must be 50 characters or less' } }
    }

    // Update the display name only (container name stays the same)
    await Service.updateOne({ id: service.id }).set({ name: trimmedName })

    sails.log.info(`Renamed service ${service.id} from "${service.name}" to "${trimmedName}"`)

    return {
      success: true,
      service: {
        id: service.id,
        name: trimmedName
      }
    }
  }
}
