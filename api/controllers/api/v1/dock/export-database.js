module.exports = {
  friendlyName: 'Export database',

  description: 'Export database tables as SQL dump.',

  inputs: {
    projectSlug: {
      type: 'string',
      required: true
    },
    environmentSlug: {
      type: 'string',
      defaultsTo: 'production'
    },
    tables: {
      type: 'json',
      description: 'Array of table names to export (empty = all tables)'
    },
    dataOnly: {
      type: 'boolean',
      defaultsTo: false
    },
    schemaOnly: {
      type: 'boolean',
      defaultsTo: false
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

  fn: async function ({ projectSlug, environmentSlug, tables, dataOnly, schemaOnly }) {
    const user = await User.findOne({ id: this.req.session.userId })
    const project = await Project.findOne({ slug: projectSlug }).populate('team')

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
      dbResult = await sails.helpers.dock.getDatabaseService(environment.id, serviceId)
    } catch (err) {
      throw { badRequest: 'No database service found for this environment.' }
    }

    const { service } = dbResult

    // Validate tables array if provided
    if (tables && !Array.isArray(tables)) {
      throw { badRequest: 'Tables must be an array of table names.' }
    }

    try {
      const result = await sails.helpers.dock.exportDatabase(service, tables, dataOnly, schemaOnly)

      sails.log.info(`[dock] Database exported from ${project.slug}/${environmentSlug} by ${user.fullName}`)

      return result
    } catch (error) {
      if (error.exportFailed) {
        return {
          success: false,
          error: error.exportFailed.message
        }
      }
      throw error
    }
  }
}
