module.exports = {
  friendlyName: 'Stream service upgrade',

  description: 'Stream service version upgrade progress.',

  inputs: {
    serviceId: {
      type: 'string',
      required: true
    }
  },

  exits: {
    success: {
      description: 'SSE stream started.'
    },
    notFound: {
      statusCode: 404
    }
  },

  fn: async function ({ serviceId }) {
    const user = await User.findOne({ id: this.req.session.userId }).populate(
      'team'
    )
    const service = await Service.findOne({ id: serviceId }).populate(
      'environment'
    )
    if (!service) throw 'notFound'

    const environment = await Environment.findOne({
      id: service.environment.id
    }).populate('project')
    const project = await Project.findOne({ id: environment.project.id })
    if (!project || project.team !== user.team.id) throw 'notFound'

    if (
      service.upgradeState?.status === 'completed' ||
      service.upgradeState?.status === 'failed'
    ) {
      const stream = this.res.sse()
      stream.send(service.upgradeState)
      stream.close()
      return stream.wait()
    }

    return sails.sse.subscribe(
      this.req,
      this.res,
      `service-upgrade:${service.id}`
    )
  }
}
