module.exports = {
  friendlyName: 'Get historical logs',

  description: 'Get paginated historical log entries for an app.',

  inputs: {
    projectSlug: {
      type: 'string',
      required: true
    },
    environmentSlug: {
      type: 'string',
      defaultsTo: 'production'
    },
    page: {
      type: 'number',
      defaultsTo: 1,
      min: 1
    },
    limit: {
      type: 'number',
      defaultsTo: 20,
      max: 100
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

  fn: async function ({ projectSlug, environmentSlug, page, limit }) {
    const user = await User.findOne({ id: this.req.session.userId })

    const project = await Project.findOne({ slug: projectSlug }).populate('team')
    if (!project) throw 'notFound'

    if (project.team.id !== user.team) throw 'forbidden'

    const environment = await Environment.findOne({ project: project.id, slug: environmentSlug })
    if (!environment) throw 'notFound'

    const skip = (page - 1) * limit

    const [logs, totalCount] = await Promise.all([
      AppLog.find({ environment: environment.id })
        .sort('endedAt DESC')
        .skip(skip)
        .limit(limit),
      AppLog.count({ environment: environment.id })
    ])

    return {
      logs,
      pagination: {
        page,
        limit,
        totalCount,
        totalPages: Math.ceil(totalCount / limit)
      }
    }
  }
}
