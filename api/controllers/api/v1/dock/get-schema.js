module.exports = {
  friendlyName: 'Get database schema',

  description: 'Get the current database schema (tables and columns).',

  inputs: {
    projectSlug: {
      type: 'string',
      required: true
    },
    environmentSlug: {
      type: 'string',
      defaultsTo: 'production'
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

  fn: async function ({ projectSlug, environmentSlug }) {
    const user = await User.findOne({ id: this.req.session.userId })
    const project = await Project.findOne({ slug: projectSlug }).populate(
      'team'
    )

    if (!project) {
      throw 'notFound'
    }

    if (project.team.id !== user.team) {
      throw 'forbidden'
    }

    const environment = await Environment.findOne({
      project: project.id,
      slug: environmentSlug
    })

    if (!environment) {
      throw 'notFound'
    }

    // Get database service - use serviceId from query params if available
    const serviceId = this.req.query.service
    let dbResult
    try {
      dbResult = await sails.helpers.dock.getDatabaseService(
        environment.id,
        serviceId
      )
    } catch (err) {
      throw { badRequest: 'No database service found for this environment.' }
    }

    const { service } = dbResult

    // Get schema
    const schema = await sails.helpers.dock.getSchema(service)

    return {
      databaseType: service.type,
      database: service.database,
      ...schema
    }
  }
}
