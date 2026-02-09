module.exports = {
  friendlyName: 'Execute Redis command',

  description: 'Execute a Redis CLI command against a running Redis service.',

  inputs: {
    serviceId: {
      type: 'number',
      required: true
    },
    command: {
      type: 'string',
      required: true,
      maxLength: 10000
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

  fn: async function ({ serviceId, command }) {
    const user = await User.findOne({ id: this.req.session.userId })

    const service = await Service.findOne({ id: serviceId })
      .populate('environment')

    if (!service || service.type !== 'redis') {
      throw 'notFound'
    }

    const environment = await Environment.findOne({ id: service.environment.id })
    const project = await Project.findOne({ id: environment.project }).populate('team')

    if (!project) {
      throw 'notFound'
    }

    if (project.team.id !== user.team) {
      throw 'forbidden'
    }

    if (service.status !== 'running') {
      throw { badRequest: 'Redis service is not running.' }
    }

    const result = await sails.helpers.docker.executeRedisCommand(service, command)

    return result
  }
}
