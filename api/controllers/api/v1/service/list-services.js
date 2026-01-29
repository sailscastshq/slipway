module.exports = {
  friendlyName: 'List services',

  description: 'List all services for an environment.',

  inputs: {
    projectIdOrSlug: {
      type: 'string',
      required: true,
      description: 'Project ID or slug'
    },
    environmentIdOrSlug: {
      type: 'string',
      required: true,
      description: 'Environment ID or slug'
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

  fn: async function ({ projectIdOrSlug, environmentIdOrSlug }) {
    const user = await User.findOne({ id: this.req.session.userId })

    // Find project by ID or slug
    const project = await Project.findOne({
      or: [{ id: projectIdOrSlug }, { slug: projectIdOrSlug }]
    }).populate('team')

    if (!project) {
      throw 'notFound'
    }

    if (project.team.id !== user.team) {
      throw 'forbidden'
    }

    // Find environment by ID or slug
    const environment = await Environment.findOne({
      project: project.id,
      or: [{ id: environmentIdOrSlug }, { slug: environmentIdOrSlug }]
    })

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
