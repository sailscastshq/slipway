module.exports = {
  friendlyName: 'List services',

  description: 'List all services for an environment.',

  inputs: {
    projectSlug: {
      type: 'string',
      required: true,
      description: 'Project slug'
    },
    environmentSlug: {
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
    }
  },

  fn: async function ({ projectSlug, environmentSlug }) {
    const user = await User.findOne({ id: this.req.session.userId })

    const project = await Project.findOne({ slug: projectSlug }).populate('team')

    if (!project) {
      throw 'notFound'
    }

    if (project.team.id !== user.team) {
      throw 'forbidden'
    }

    const environment = await Environment.findOne({ project: project.id, slug: environmentSlug })

    if (!environment) {
      throw 'notFound'
    }

    const services = await Service.find({ environment: environment.id })
      .sort('createdAt ASC')

    // Add connection URLs (without exposing passwords in list)
    const servicesWithInfo = services.map(service => ({
      id: service.id,
      name: service.name,
      type: service.type,
      version: service.version,
      status: service.status,
      internalHost: service.internalHost,
      internalPort: service.internalPort,
      database: service.database,
      createdAt: service.createdAt
    }))

    return { services: servicesWithInfo }
  }
}
