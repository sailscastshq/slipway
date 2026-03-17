module.exports = {
  friendlyName: 'List backups',

  description: 'List backups for a service.',

  inputs: {
    serviceId: {
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

  fn: async function ({ serviceId }) {
    const user = await User.findOne({ id: this.req.session.userId })

    const service = await Service.findOne({ id: serviceId }).populate(
      'environment'
    )
    if (!service) {
      throw 'notFound'
    }

    const environment = await Environment.findOne({
      id: service.environment.id
    }).populate('project')
    const project = await Project.findOne({
      id: environment.project.id
    }).populate('team')

    if (project.team.id !== user.team) {
      throw 'forbidden'
    }

    const backups = await Backup.find({ service: service.id })
      .sort('createdAt DESC')
      .limit(20)
      .populate('triggeredBy')

    return {
      backups: backups.map((b) => ({
        id: b.id,
        status: b.status,
        type: b.type,
        s3Key: b.s3Key,
        sizeBytes: b.sizeBytes,
        durationMs: b.durationMs,
        errorMessage: b.errorMessage,
        startedAt: b.startedAt,
        completedAt: b.completedAt,
        createdAt: b.createdAt,
        triggeredBy: b.triggeredBy ? { fullName: b.triggeredBy.fullName } : null
      }))
    }
  }
}
